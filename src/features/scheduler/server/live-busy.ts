import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetcher,
  providerOf,
  syncConfiguration,
  timeZoneOf,
} from "@/features/calendar/sync/server/connections";
import { isCalendarSyncAllowed } from "@/features/calendar/sync/server/settings";
import type { Database } from "@/types/database";
import {
  busyOfRemote,
  cacheUsable,
  intervalsFromJson,
  intervalsToJson,
  LIVE_STALE_FALLBACK_MS,
  LIVE_WINDOW_AFTER_MS,
  LIVE_WINDOW_BEFORE_MS,
} from "../remote-busy";
import type { Interval } from "../slots";

type Admin = SupabaseClient<Database>;

/**
 * Busy times of a host's connected calendars read straight from Google or
 * Apple for the scheduler (30.4), whether the person shows them in Gradus or
 * not. One read covers the next 63 days and is kept in scheduler_busy_cache
 * (server only) for a few minutes; holding and booking a time ask for a
 * fresher one. A read that fails or takes too long falls back to the last
 * one of the day, and null tells the caller to use the events Gradus synced.
 * Always for one person, after the caller decided whose times these are.
 */

/** The whole live read never waits longer than this. */
const LIVE_BUDGET_MS = 5000;

type CalendarRow = {
  id: string;
  connection_id: string;
  external_id: string;
};

async function readOne(
  admin: Admin,
  userId: string,
  calendar: CalendarRow,
  connection: { id: string; user_id: string; provider: string; secret_cipher: string },
  timeZone: string,
  window: { from: number; to: number },
): Promise<Interval[] | null> {
  const provider = providerOf(admin, connection, timeZone, fetcher);
  if (!provider) return null;
  const [pulled, links] = await Promise.all([
    provider.pull(calendar.external_id, null, window),
    admin
      .from("calendar_external_links")
      .select("external_id")
      .eq("calendar_id", calendar.id)
      .eq("user_id", userId)
      .eq("origin", "gradus")
      .limit(5000),
  ]);
  if (links.error) throw links.error;
  const own = new Set((links.data ?? []).map((row) => row.external_id));
  const busy = busyOfRemote(pulled.events, own);
  const { error } = await admin.from("scheduler_busy_cache").upsert(
    {
      calendar_id: calendar.id,
      user_id: userId,
      busy: intervalsToJson(busy),
      window_from: new Date(window.from).toISOString(),
      window_to: new Date(window.to).toISOString(),
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "calendar_id" },
  );
  if (error) console.error("[scheduler] busy cache write failed", error.code);
  return busy;
}

/**
 * The busy times of each of `calendarIds` (the host's own connected
 * calendars; others are ignored). A calendar missing from the answer could
 * not be read: the caller uses what Gradus synced of it, if anything.
 */
export async function liveCalendarBusy(
  admin: Admin,
  userId: string,
  calendarIds: readonly string[],
  maxAgeMs: number,
  now = Date.now(),
): Promise<Map<string, Interval[]>> {
  const out = new Map<string, Interval[]>();
  if (!calendarIds.length || !syncConfiguration().key) return out;
  const window = { from: now - LIVE_WINDOW_BEFORE_MS, to: now + LIVE_WINDOW_AFTER_MS };
  const needed = { from: now, to: now + LIVE_WINDOW_AFTER_MS - LIVE_WINDOW_BEFORE_MS };

  const [calendars, cache] = await Promise.all([
    admin
      .from("calendar_connection_calendars")
      .select("id, connection_id, external_id")
      .eq("user_id", userId)
      .in("id", [...calendarIds])
      .limit(200),
    admin
      .from("scheduler_busy_cache")
      .select("calendar_id, busy, fetched_at, window_from, window_to")
      .eq("user_id", userId)
      .in("calendar_id", [...calendarIds])
      .limit(200),
  ]);
  if (calendars.error) throw calendars.error;
  if (cache.error) throw cache.error;
  const cached = new Map((cache.data ?? []).map((row) => [row.calendar_id, row]));

  const stale: CalendarRow[] = [];
  for (const calendar of calendars.data ?? []) {
    const row = cached.get(calendar.id);
    if (cacheUsable(row, needed, now, maxAgeMs)) out.set(calendar.id, intervalsFromJson(row!.busy));
    else stale.push(calendar);
  }
  if (!stale.length) return out;
  if (!(await isCalendarSyncAllowed(admin, userId))) return out;

  const { data: connections, error } = await admin
    .from("calendar_connections")
    .select("id, user_id, provider, secret_cipher, status")
    .eq("user_id", userId)
    .eq("status", "active")
    .in("id", [...new Set(stale.map((calendar) => calendar.connection_id))])
    .limit(5);
  if (error) throw error;
  const byId = new Map((connections ?? []).map((row) => [row.id, row]));
  const timeZone = await timeZoneOf(admin, userId);

  const reads = stale.map(async (calendar) => {
    const connection = byId.get(calendar.connection_id);
    if (!connection) return;
    try {
      const busy = await readOne(admin, userId, calendar, connection, timeZone, window);
      if (busy) out.set(calendar.id, busy);
    } catch (readError) {
      console.error(
        "[scheduler] live busy read failed",
        readError instanceof Error ? readError.message : "unknown",
      );
    }
  });
  await Promise.race([
    Promise.all(reads),
    new Promise((resolve) => setTimeout(resolve, LIVE_BUDGET_MS)),
  ]);

  // Not read in time: the last read of the day still says more than nothing.
  for (const calendar of stale) {
    if (out.has(calendar.id)) continue;
    const row = cached.get(calendar.id);
    if (cacheUsable(row, needed, now, LIVE_STALE_FALLBACK_MS)) {
      out.set(calendar.id, intervalsFromJson(row!.busy));
    }
  }
  // A copy: reads still running after the budget must not change the answer.
  return new Map(out);
}
