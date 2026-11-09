import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { icsBusy, type BusyInterval } from "../ics/parse";
import { BUSY_HORIZON_DAYS } from "../types";
import { decryptSecret, IntegrationKeyError } from "./crypto";
import { fetchIcs } from "./ics-fetch";

/**
 * Subscribed calendars (Settings → Calendar): the server downloads the
 * secret ICS link, keeps the busy times of the next 60 days and nothing else
 * (no titles, never a calendar event). Refreshed when the booking page opens
 * with a cache older than 10 minutes (24.4), by hand, and by a daily cron.
 */

type Admin = SupabaseClient<Database>;

const DAY = 86_400_000;
/** The daily cron's batch; the oldest first, so every one gets its turn. */
export const CRON_BATCH = 200;
const CONCURRENCY = 4;

export type RefreshResult = { ok: true; intervals: number } | { ok: false; code: string };

type SubscriptionSecret = { id: string; user_id: string; url_cipher: string };

/** The window the busy times cover: from the start of yesterday to 60 days ahead. */
export function busyWindow(now: number): { from: number; to: number } {
  return { from: now - DAY, to: now + BUSY_HORIZON_DAYS * DAY };
}

/** Downloads and reads one calendar; the text never leaves this function. */
export async function readCalendar(
  url: string,
  timeZone: string,
  now: number,
  fetcher: typeof fetchIcs = fetchIcs,
): Promise<{ ok: true; busy: BusyInterval[] } | { ok: false; code: string }> {
  const fetched = await fetcher(url);
  if (!fetched.ok) return { ok: false, code: fetched.code };
  const { from, to } = busyWindow(now);
  return { ok: true, busy: icsBusy(fetched.text, { from, to, defaultTimeZone: timeZone }) };
}

async function zonesOf(admin: Admin, users: string[]): Promise<Map<string, string>> {
  const zones = new Map<string, string>();
  if (!users.length) return zones;
  const { data, error } = await admin
    .from("user_settings")
    .select("user_id, timezone")
    .in("user_id", users);
  if (error) throw error;
  for (const row of data ?? []) zones.set(row.user_id, row.timezone);
  return zones;
}

/** Refreshes one subscription and stores what came out (busy times, or the error code). */
export async function refreshSubscription(
  admin: Admin,
  row: SubscriptionSecret,
  timeZone: string,
  now = Date.now(),
): Promise<RefreshResult> {
  let result: RefreshResult;
  let busy: BusyInterval[] | null = null;
  try {
    const url = decryptSecret(row.url_cipher);
    const read = await readCalendar(url, timeZone, now);
    if (read.ok) {
      busy = read.busy;
      result = { ok: true, intervals: read.busy.length };
    } else {
      result = { ok: false, code: read.code };
    }
  } catch (error) {
    result = { ok: false, code: error instanceof IntegrationKeyError ? "key" : "network" };
  }
  const stamp = new Date(now).toISOString();
  const update: Database["public"]["Tables"]["calendar_subscriptions"]["Update"] = result.ok
    ? {
        busy: busy as unknown as Json,
        busy_until: new Date(busyWindow(now).to).toISOString(),
        last_fetched_at: stamp,
        last_status: "ok",
        last_error: null,
      }
    : // A failed download keeps the last busy times: better than a calendar that looks free.
      { last_fetched_at: stamp, last_status: "error", last_error: result.code };
  const { error } = await admin
    .from("calendar_subscriptions")
    .update(update)
    .eq("id", row.id)
    .eq("user_id", row.user_id);
  if (error) throw error;
  return result;
}

async function pool<T>(items: T[], work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        await work(item);
      }
    }),
  );
}

async function refreshRows(admin: Admin, rows: SubscriptionSecret[], now: number) {
  const zones = await zonesOf(admin, [...new Set(rows.map((row) => row.user_id))]);
  let ok = 0;
  let failed = 0;
  await pool(rows, async (row) => {
    const result = await refreshSubscription(
      admin,
      row,
      zones.get(row.user_id) ?? "Europe/Prague",
      now,
    ).catch(() => ({ ok: false, code: "store" }) as RefreshResult);
    if (result.ok) ok++;
    else failed++;
  });
  return { ok, failed };
}

/** The daily cron: the subscriptions fetched longest ago (never fetched first). */
export async function refreshDueSubscriptions(admin: Admin, now = Date.now(), limit = CRON_BATCH) {
  const { data, error } = await admin
    .from("calendar_subscriptions")
    .select("id, user_id, url_cipher")
    .order("last_fetched_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw error;
  return refreshRows(admin, data ?? [], now);
}

/** One person's subscriptions older than `maxAgeMs` (the booking page, the preview). */
export async function refreshStaleForUser(
  admin: Admin,
  userId: string,
  maxAgeMs: number,
  now = Date.now(),
) {
  const { data, error } = await admin
    .from("calendar_subscriptions")
    .select("id, user_id, url_cipher, last_fetched_at")
    .eq("user_id", userId)
    .or(`last_fetched_at.is.null,last_fetched_at.lt.${new Date(now - maxAgeMs).toISOString()}`)
    .limit(10);
  if (error) throw error;
  return refreshRows(admin, data ?? [], now);
}
