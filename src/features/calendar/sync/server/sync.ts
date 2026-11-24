import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { track } from "@/lib/analytics/track";
import type { Database } from "@/types/database";
import { flushOutbox, pullCalendar, type SyncStore } from "../engine";
import { revokeGoogleToken, type GoogleProvider } from "../providers/google";
import { ProviderError, type CalendarProvider } from "../types";
import {
  fetcher,
  openConnectionSecret,
  providerKeyOf,
  providerOf,
  syncConfiguration,
  timeZoneOf,
  type ConnectionRow,
} from "./connections";
import { isCalendarSyncAllowed } from "./settings";
import { createSupabaseSyncStore } from "./store";

type Admin = SupabaseClient<Database>;

/**
 * Running the sync (28.10) for a person: read their calendars (when the
 * calendar opens, on "Sync now", on Google's notification, daily), then
 * send what waits in their outbox (right after every change in Gradus).
 * A failure of one calendar never stops the others; an account that took
 * the access back is marked so Settings asks to connect again.
 */

export type SyncTrigger = "open" | "manual" | "push" | "cron" | "change" | "connect";

const CONNECTION_COLUMNS = "id, user_id, provider, secret_cipher, status, last_synced_at";
/** Opening the calendar reads again at most this often. */
export const OPEN_MIN_AGE_MS = 2 * 60_000;
/** Google's channel lives a week at most; renewed when it has less than this left. */
const CHANNEL_RENEW_MS = 2 * 86_400_000;
const CHANNEL_TTL_MS = 7 * 86_400_000;

type Connection = ConnectionRow & { status: string; last_synced_at: string | null };

export type RunSummary = {
  applied: number;
  deleted: number;
  sent: number;
  conflicts: number;
  failed: number;
};

const empty = (): RunSummary => ({ applied: 0, deleted: 0, sent: 0, conflicts: 0, failed: 0 });

function codeOf(error: unknown): string {
  return error instanceof ProviderError ? error.code : "unknown";
}

async function markConnection(admin: Admin, connection: Connection, error: string | null) {
  await admin
    .from("calendar_connections")
    .update(
      error
        ? { status: error === "auth" ? "error" : "active", last_error: error }
        : { status: "active", last_error: null, last_synced_at: new Date().toISOString() },
    )
    .eq("id", connection.id)
    .eq("user_id", connection.user_id);
}

async function connectionsOf(admin: Admin, userId: string, connectionId?: string): Promise<Connection[]> {
  let query = admin.from("calendar_connections").select(CONNECTION_COLUMNS).eq("user_id", userId);
  if (connectionId) query = query.eq("id", connectionId);
  const { data, error } = await query.limit(5);
  if (error) throw error;
  return (data ?? []) as Connection[];
}

/** A resolver that makes each connection's provider once per run. */
function resolver(admin: Admin, userId: string, timeZone: string) {
  const cache = new Map<string, CalendarProvider | null>();
  return async (connectionId: string) => {
    if (cache.has(connectionId)) return cache.get(connectionId) ?? null;
    const { data } = await admin
      .from("calendar_connections")
      .select(CONNECTION_COLUMNS)
      .eq("id", connectionId)
      .eq("user_id", userId)
      .maybeSingle();
    const provider = data && data.status === "active" ? providerOf(admin, data, timeZone, fetcher) : null;
    cache.set(connectionId, provider);
    return provider;
  };
}

/** Reads every calendar a connection reads; returns what came in. */
async function pullConnection(
  admin: Admin,
  store: SyncStore,
  connection: Connection,
  provider: CalendarProvider,
  summary: RunSummary,
  full: boolean,
) {
  const { data: calendars, error } = await admin
    .from("calendar_connection_calendars")
    .select("id, connection_id, external_id, sync_state, can_write")
    .eq("connection_id", connection.id)
    .eq("read", true)
    .limit(50);
  if (error) throw error;
  for (const row of calendars ?? []) {
    try {
      const pulled = await pullCalendar(
        provider,
        store,
        {
          id: row.id,
          connectionId: row.connection_id,
          externalId: row.external_id,
          syncState: row.sync_state,
          canWrite: row.can_write,
        },
        Date.now(),
        // Apple tells changes only by its ctag: the daily run reads everything once.
        { full: full && connection.provider === "apple" },
      );
      summary.applied += pulled.applied;
      summary.deleted += pulled.deleted;
      summary.conflicts += pulled.conflicts;
    } catch (pullError) {
      summary.failed++;
      const code = codeOf(pullError);
      await admin
        .from("calendar_connection_calendars")
        .update({ last_error: code })
        .eq("id", row.id);
      // Access taken back: the whole connection waits for a new consent.
      if (code === "auth") throw pullError;
    }
  }
}

/**
 * Reads a person's calendars and sends their waiting changes. `minAgeMs`
 * skips connections read more recently (opening the calendar).
 */
export async function syncUser(
  admin: Admin,
  userId: string,
  options: { trigger: SyncTrigger; connectionId?: string; minAgeMs?: number; now?: number } = {
    trigger: "manual",
  },
): Promise<RunSummary> {
  const summary = empty();
  if (!syncConfiguration().key) return summary;
  // An account taken off the list stops syncing too, not only connecting.
  if (!(await isCalendarSyncAllowed(admin, userId))) return summary;
  const now = options.now ?? Date.now();
  const store = createSupabaseSyncStore(admin);
  const timeZone = await timeZoneOf(admin, userId);
  const connections = await connectionsOf(admin, userId, options.connectionId);
  for (const connection of connections) {
    if (connection.status !== "active" && options.trigger !== "manual") continue;
    if (
      options.minAgeMs &&
      connection.last_synced_at &&
      now - Date.parse(connection.last_synced_at) < options.minAgeMs
    ) {
      continue;
    }
    const provider = providerOf(admin, connection, timeZone, fetcher);
    if (!provider) {
      summary.failed++;
      await markConnection(admin, connection, "auth");
      continue;
    }
    const before = { ...summary };
    try {
      await pullConnection(admin, store, connection, provider, summary, options.trigger === "cron");
      await markConnection(admin, connection, null);
    } catch (error) {
      summary.failed++;
      await markConnection(admin, connection, codeOf(error));
    }
    await track(
      "calendar_sync_run",
      {
        provider: providerKeyOf(connection.provider),
        trigger: options.trigger,
        applied: Math.min(summary.applied - before.applied, 10_000),
        conflicts: Math.min(summary.conflicts - before.conflicts, 1000),
        ok: summary.failed === before.failed,
      },
      { admin, userId },
    ).catch(() => undefined);
    if (summary.conflicts > before.conflicts) {
      await track(
        "calendar_sync_conflict",
        { provider: providerKeyOf(connection.provider), count: Math.min(summary.conflicts - before.conflicts, 1000) },
        { admin, userId },
      ).catch(() => undefined);
    }
  }
  const flushed = await flushUser(admin, userId, timeZone);
  summary.sent += flushed.sent;
  summary.failed += flushed.failed;
  summary.conflicts += flushed.conflicts;
  return summary;
}

/** Sends a person's waiting changes now (after a change in Gradus, a booking). */
export async function flushUser(
  admin: Admin,
  userId: string,
  timeZone?: string,
): Promise<{ sent: number; failed: number; conflicts: number }> {
  if (!syncConfiguration().key) return { sent: 0, failed: 0, conflicts: 0 };
  const { count } = await admin
    .from("calendar_sync_outbox")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (!count) return { sent: 0, failed: 0, conflicts: 0 };
  if (!(await isCalendarSyncAllowed(admin, userId))) return { sent: 0, failed: 0, conflicts: 0 };
  const zone = timeZone ?? (await timeZoneOf(admin, userId));
  return flushOutbox(userId, createSupabaseSyncStore(admin), resolver(admin, userId, zone), zone);
}

/** The same, never throwing and never waiting longer than `ms`. */
export async function flushUserQuietly(admin: Admin, userId: string, ms = 8000): Promise<void> {
  await Promise.race([
    flushUser(admin, userId).catch((error) =>
      console.error("[calendar-sync] flush failed", error instanceof Error ? error.message : "unknown"),
    ),
    new Promise((resolve) => setTimeout(resolve, ms)),
  ]);
}

/**
 * Reads again before the booking page answers ("live" busy times), when the
 * last read is older than `maxAgeMs`; never longer than `budgetMs`.
 */
export async function syncUserIfStale(admin: Admin, userId: string, maxAgeMs: number, budgetMs = 4000) {
  if (!syncConfiguration().key) return;
  // The usual host has no connection: one query, nothing else.
  const { data } = await admin
    .from("calendar_connections")
    .select("last_synced_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(5);
  const now = Date.now();
  const stale = (data ?? []).some(
    (row) => !row.last_synced_at || now - Date.parse(row.last_synced_at) >= maxAgeMs,
  );
  if (!stale) return;
  await Promise.race([
    syncUser(admin, userId, { trigger: "open", minAgeMs: maxAgeMs }).catch((error) =>
      console.error("[calendar-sync] stale sync failed", error instanceof Error ? error.message : "unknown"),
    ),
    new Promise((resolve) => setTimeout(resolve, budgetMs)),
  ]);
}

// ---------------------------------------------------------------------------
// Google's notifications (events.watch)
// ---------------------------------------------------------------------------

export function channelTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

export type PushCheck =
  | { ok: true; userId: string; connectionId: string; calendarId: string; state: string }
  | { ok: false; status: 401 | 404 };

/** Whether a notification is one of ours: the channel we made, its secret token, its resource. */
export async function checkPush(
  admin: Admin,
  headers: { channelId: string | null; token: string | null; resourceId: string | null; state: string | null },
): Promise<PushCheck> {
  const { channelId, token, resourceId } = headers;
  if (!channelId || !/^[A-Za-z0-9_-]{1,64}$/.test(channelId)) return { ok: false, status: 404 };
  const { data } = await admin
    .from("calendar_connection_calendars")
    .select("id, user_id, connection_id, channel_token_hash, channel_resource_id, read")
    .eq("channel_id", channelId)
    .maybeSingle();
  if (!data || !data.channel_token_hash) return { ok: false, status: 404 };
  if (!token || token.length > 256 || !sameHash(channelTokenHash(token), data.channel_token_hash)) {
    return { ok: false, status: 401 };
  }
  if (!resourceId || resourceId !== data.channel_resource_id) return { ok: false, status: 401 };
  return { ok: true, userId: data.user_id, connectionId: data.connection_id, calendarId: data.id, state: headers.state ?? "" };
}

/** Opens (or renews) the notification channel of each read Google calendar of a connection. */
export async function ensureChannels(
  admin: Admin,
  connection: ConnectionRow,
  address: string,
  now = Date.now(),
): Promise<number> {
  if (connection.provider !== "google" || !address.startsWith("https://")) return 0;
  const timeZone = await timeZoneOf(admin, connection.user_id);
  const provider = providerOf(admin, connection, timeZone, fetcher) as GoogleProvider | null;
  if (!provider) return 0;
  const { data: calendars, error } = await admin
    .from("calendar_connection_calendars")
    .select("id, external_id, read, channel_id, channel_resource_id, channel_expires_at")
    .eq("connection_id", connection.id)
    .limit(50);
  if (error) throw error;
  let opened = 0;
  for (const calendar of calendars ?? []) {
    const expires = calendar.channel_expires_at ? Date.parse(calendar.channel_expires_at) : 0;
    const wanted = calendar.read;
    const fresh = calendar.channel_id && expires - now > CHANNEL_RENEW_MS;
    if (wanted && fresh) continue;
    if (calendar.channel_id && calendar.channel_resource_id) {
      await provider.stopWatch(calendar.channel_id, calendar.channel_resource_id).catch(() => undefined);
    }
    if (!wanted) {
      if (calendar.channel_id) {
        await admin
          .from("calendar_connection_calendars")
          .update({ channel_id: null, channel_resource_id: null, channel_token_hash: null, channel_expires_at: null })
          .eq("id", calendar.id);
      }
      continue;
    }
    const id = randomBytes(18).toString("base64url");
    const token = randomBytes(32).toString("base64url");
    try {
      const channel = await provider.watch(calendar.external_id, {
        id,
        token,
        address,
        expiresAt: now + CHANNEL_TTL_MS,
      });
      await admin
        .from("calendar_connection_calendars")
        .update({
          channel_id: id,
          channel_resource_id: channel.resourceId,
          channel_token_hash: channelTokenHash(token),
          channel_expires_at: new Date(channel.expiresAt ?? now + CHANNEL_TTL_MS).toISOString(),
        })
        .eq("id", calendar.id);
      opened++;
    } catch (watchError) {
      console.error("[calendar-sync] watch failed", codeOf(watchError));
    }
  }
  return opened;
}

/** Stops every channel of a connection (before it goes). */
async function stopChannels(admin: Admin, connection: ConnectionRow) {
  if (connection.provider !== "google") return;
  const provider = providerOf(admin, connection, "UTC", fetcher) as GoogleProvider | null;
  if (!provider) return;
  const { data } = await admin
    .from("calendar_connection_calendars")
    .select("channel_id, channel_resource_id")
    .eq("connection_id", connection.id)
    .not("channel_id", "is", null)
    .limit(50);
  for (const row of data ?? []) {
    if (row.channel_id && row.channel_resource_id) {
      await provider.stopWatch(row.channel_id, row.channel_resource_id).catch(() => undefined);
    }
  }
}

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

/**
 * Disconnect: the channels stop, Google forgets the access, the events read
 * in leave Gradus (Gradus's own stay, unlinked), the tokens are deleted.
 * Nothing is deleted in the other calendar.
 */
export async function disconnectConnection(admin: Admin, userId: string, connectionId: string): Promise<boolean> {
  const { data: connection } = await admin
    .from("calendar_connections")
    .select("id, user_id, provider, secret_cipher")
    .eq("id", connectionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!connection) return false;
  await stopChannels(admin, connection).catch(() => undefined);
  const secret = openConnectionSecret(connection.secret_cipher);
  if (secret?.kind === "google") {
    await revokeGoogleToken(fetcher, secret.refreshToken).catch(() => false);
  }
  const { error: forgetError } = await admin.rpc("calendar_sync_forget", { _connection: connection.id });
  if (forgetError) throw forgetError;
  const { error } = await admin.from("calendar_connections").delete().eq("id", connection.id).eq("user_id", userId);
  if (error) throw error;
  return true;
}

// ---------------------------------------------------------------------------
// The daily cron
// ---------------------------------------------------------------------------

/** Every connection read again (the oldest first), channels renewed, outboxes sent. */
export async function syncDueConnections(
  admin: Admin,
  pushAddress: string | null,
  limit = 200,
): Promise<{ users: number; failed: number; channels: number }> {
  if (!syncConfiguration().key) return { users: 0, failed: 0, channels: 0 };
  const { data, error } = await admin
    .from("calendar_connections")
    .select("id, user_id, provider, secret_cipher")
    .eq("status", "active")
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw error;
  const users = new Set<string>();
  let failed = 0;
  let channels = 0;
  for (const connection of data ?? []) {
    if (pushAddress) channels += await ensureChannels(admin, connection, pushAddress).catch(() => 0);
    users.add(connection.user_id);
  }
  for (const userId of users) {
    const summary = await syncUser(admin, userId, { trigger: "cron" }).catch(() => ({ ...empty(), failed: 1 }));
    failed += summary.failed;
  }
  // Changes waiting for people whose connection broke meanwhile: dropped after their tries.
  return { users: users.size, failed, channels };
}
