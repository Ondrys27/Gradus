import { NextResponse } from "next/server";
import { z } from "zod";
import { syncConfiguration } from "@/features/calendar/sync/server/connections";
import { calendarSyncGate, sessionUserId } from "@/features/calendar/sync/server/gate";
import { isCalendarSyncAllowed } from "@/features/calendar/sync/server/settings";
import { flushUser, OPEN_MIN_AGE_MS, syncUser } from "@/features/calendar/sync/server/sync";
import type { CalendarSyncOverview } from "@/features/calendar/sync/overview";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/** "Sync now" at most this often per connection. */
const MANUAL_MIN_AGE_MS = 30_000;

/**
 * Two-way calendar sync for the screens (28.10).
 * GET: whether the account may connect, whether this server can, and the
 * account's connections with their calendars (read with the user's client).
 * POST: `open` reads the calendars when the calendar opens (at most every
 * 2 minutes), `change` sends what waits after a change in Gradus, `manual`
 * is "Sync now". An account without a connection costs one query.
 */
export async function GET() {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const supabase = await createClient();
  const [connections, calendars] = await Promise.all([
    supabase
      .from("calendar_connections")
      .select("id, provider, account_label, status, last_error, last_synced_at, created_at")
      .eq("user_id", userId)
      .order("created_at")
      .limit(5),
    supabase
      .from("calendar_connection_calendars")
      .select("id, connection_id, name, is_primary, can_write, read, write, synced_at, last_error")
      .eq("user_id", userId)
      .order("name")
      .limit(500),
  ]);
  if (connections.error || calendars.error) return NextResponse.json({ error: "unknown" }, { status: 500 });
  const configuration = syncConfiguration();
  const body: CalendarSyncOverview = {
    allowed: await isCalendarSyncAllowed(createAdminClient(), userId),
    available: configuration.key,
    google: configuration.google,
    connections: (connections.data ?? []).map((connection) => ({
      id: connection.id,
      provider: connection.provider === "apple" ? "apple" : "google",
      accountLabel: connection.account_label,
      status: connection.status === "error" ? "error" : "active",
      lastError: connection.last_error,
      lastSyncedAt: connection.last_synced_at,
      calendars: (calendars.data ?? [])
        .filter((calendar) => calendar.connection_id === connection.id)
        .map((calendar) => ({
          id: calendar.id,
          name: calendar.name,
          isPrimary: calendar.is_primary,
          canWrite: calendar.can_write,
          read: calendar.read,
          write: calendar.write,
          syncedAt: calendar.synced_at,
          lastError: calendar.last_error,
        })),
    })),
  };
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}

const postBody = z.object({
  trigger: z.enum(["open", "change", "manual"]),
  connectionId: z.uuid().optional(),
});

export async function POST(request: Request) {
  const parsed = postBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { trigger, connectionId } = parsed.data;

  if (trigger !== "manual") {
    // Quiet and cheap: nothing to do for an account without a connection or a waiting change.
    const userId = await sessionUserId();
    if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (!syncConfiguration().key) return NextResponse.json({ applied: 0, sent: 0 });
    const admin = createAdminClient();
    if (trigger === "change") {
      const flushed = await flushUser(admin, userId).catch(() => ({ sent: 0 }));
      return NextResponse.json({ applied: 0, sent: flushed.sent });
    }
    const { count } = await admin
      .from("calendar_connections")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (!count) return NextResponse.json({ applied: 0, sent: 0 });
    const summary = await syncUser(admin, userId, { trigger: "open", minAgeMs: OPEN_MIN_AGE_MS }).catch(() => null);
    return NextResponse.json({ applied: (summary?.applied ?? 0) + (summary?.deleted ?? 0), sent: summary?.sent ?? 0 });
  }

  const gate = await calendarSyncGate("calendar.syncNow");
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.error === "unauthenticated" ? 401 : 403 });
  }
  const { admin, userId } = gate;
  if (connectionId) {
    const { data } = await admin
      .from("calendar_connections")
      .select("last_synced_at")
      .eq("id", connectionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return NextResponse.json({ error: "notFound" }, { status: 404 });
    if (data.last_synced_at && Date.now() - Date.parse(data.last_synced_at) < MANUAL_MIN_AGE_MS) {
      return NextResponse.json({ error: "tooSoon" }, { status: 429 });
    }
  }
  const summary = await syncUser(admin, userId, { trigger: "manual", connectionId });
  return NextResponse.json({
    applied: summary.applied + summary.deleted,
    sent: summary.sent,
    conflicts: summary.conflicts,
    failed: summary.failed,
  });
}
