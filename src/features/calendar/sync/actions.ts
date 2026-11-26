"use server";

import { after } from "next/server";
import { z } from "zod";
import { track } from "@/lib/analytics/track";
import { siteOrigin } from "@/lib/site-origin";
import { normalizeSelection } from "./overview";
import { GOOGLE_PUSH_PATH } from "./paths";
import { createAppleProvider, discoverApple } from "./providers/apple";
import { saveConnection } from "./server/connect";
import { fetcher, providerKeyOf, timeZoneOf } from "./server/connections";
import { calendarSyncGate, sessionUserId, type GateError } from "./server/gate";
import { disconnectConnection, ensureChannels, syncUser } from "./server/sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { ProviderError } from "./types";
import { addConnectionToScheduler } from "@/features/scheduler/server/scheduler-sources";

/**
 * Settings → Calendar, two-way sync (28.10): connecting Apple, choosing the
 * calendars, disconnecting. The account is always the session's; every
 * change goes through the gate (the switch, the key) and is written with the
 * admin client for that account alone. Failures come back as codes.
 */

export type SyncActionError = GateError | "invalid" | "auth" | "network" | "notFound" | "unknown";
export type SyncActionResult<T> = { ok: true; data: T } | { ok: false; error: SyncActionError };

function failure(error: unknown): { ok: false; error: SyncActionError } {
  if (error instanceof ProviderError) {
    if (error.code === "auth") return { ok: false, error: "auth" };
    if (error.code === "network" || error.code === "rateLimited")
      return { ok: false, error: "network" };
  }
  console.error(
    "[calendar-sync] action failed",
    error instanceof Error ? error.message : "unknown",
  );
  return { ok: false, error: "unknown" };
}

const appleInput = z.object({
  appleId: z.string().trim().min(3).max(320),
  // Apple's app-specific password: xxxx-xxxx-xxxx-xxxx (spaces and case forgiven).
  password: z
    .string()
    .transform((value) => value.replace(/\s+/g, "").toLowerCase())
    .pipe(z.string().regex(/^[a-z]{4}-?[a-z]{4}-?[a-z]{4}-?[a-z]{4}$/)),
});

/** Apple (iCloud): the Apple ID and an app-specific password, checked against caldav.icloud.com. */
export async function connectApple(input: {
  appleId: string;
  password: string;
  /** Connected from the scheduler's Availability (30.4): it counts there at once. */
  from?: "settings" | "scheduler";
}): Promise<SyncActionResult<{ connectionId: string }>> {
  const parsed = appleInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const gate = await calendarSyncGate("calendar.appleConnect", "apple");
  if (!gate.ok) return { ok: false, error: gate.error };
  const { admin, userId } = gate;
  const password = parsed.data.password.includes("-")
    ? parsed.data.password
    : parsed.data.password.replace(/(.{4})(?=.)/g, "$1-");
  try {
    const credentials = { username: parsed.data.appleId, password };
    const discovered = await discoverApple(credentials, fetcher);
    const provider = createAppleProvider({
      ...credentials,
      homeUrl: discovered.homeUrl,
      fetcher,
      timeZone: await timeZoneOf(admin, userId),
    });
    const calendars = await provider.listCalendars();
    const { connectionId } = await saveConnection(admin, {
      userId,
      provider: "apple",
      accountLabel: parsed.data.appleId,
      secret: { kind: "apple", ...credentials, homeUrl: discovered.homeUrl },
      calendars,
    });
    if (input.from === "scheduler") {
      await addConnectionToScheduler(admin, userId, connectionId).catch(() => undefined);
    }
    after(() =>
      syncUser(admin, userId, { trigger: "connect", connectionId }).then(
        () => undefined,
        () => undefined,
      ),
    );
    return { ok: true, data: { connectionId } };
  } catch (error) {
    return failure(error);
  }
}

const selectionInput = z.object({
  connectionId: z.uuid(),
  read: z.array(z.uuid()).max(200),
  write: z.uuid().nullable(),
});

/**
 * Which calendars are read and which one is written to. A calendar no longer
 * read takes its events out of Gradus (Gradus's own stay); the one written
 * to is read too.
 */
export async function saveCalendarSelection(input: {
  connectionId: string;
  read: string[];
  write: string | null;
}): Promise<SyncActionResult<null>> {
  const parsed = selectionInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const gate = await calendarSyncGate("calendar.selection");
  if (!gate.ok) return { ok: false, error: gate.error };
  const { admin, userId } = gate;
  try {
    const { data: connection } = await admin
      .from("calendar_connections")
      .select("id, user_id, provider, secret_cipher")
      .eq("id", parsed.data.connectionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!connection) return { ok: false, error: "notFound" };
    const { data: calendars, error } = await admin
      .from("calendar_connection_calendars")
      .select("id, can_write, read, write")
      .eq("connection_id", connection.id)
      .limit(500);
    if (error) throw error;
    const selection = normalizeSelection(
      (calendars ?? []).map((row) => ({ id: row.id, canWrite: row.can_write })),
      parsed.data.read,
      parsed.data.write,
    );
    const reading = new Set(selection.read);

    // The calendar written to moves: the old one first lets go (one per person).
    if (selection.write) {
      const { error: clearError } = await admin
        .from("calendar_connection_calendars")
        .update({ write: false })
        .eq("user_id", userId)
        .eq("write", true)
        .neq("id", selection.write);
      if (clearError) throw clearError;
    }
    for (const row of calendars ?? []) {
      const read = reading.has(row.id);
      const write = selection.write === row.id;
      if (row.read === read && row.write === write) continue;
      if (row.read && !read) {
        // Its events leave Gradus; links of Gradus's own events written there go with them.
        const { error: forgetError } = await admin.rpc("calendar_sync_forget", {
          _connection: connection.id,
          _calendar: row.id,
        });
        if (forgetError) throw forgetError;
      }
      const { error: updateError } = await admin
        .from("calendar_connection_calendars")
        .update({ read, write, ...(read && !row.read ? { sync_state: null } : {}) })
        .eq("id", row.id)
        .eq("user_id", userId);
      if (updateError) throw updateError;
    }
    await track(
      "calendar_sync_calendars_saved",
      {
        provider: providerKeyOf(connection.provider),
        read: reading.size,
        write: Boolean(selection.write),
      },
      { admin, userId },
    ).catch(() => undefined);
    const origin = await siteOrigin();
    after(async () => {
      await ensureChannels(admin, connection, `${origin}${GOOGLE_PUSH_PATH}`).catch(() => 0);
      await syncUser(admin, userId, { trigger: "manual", connectionId: connection.id }).catch(
        () => undefined,
      );
    });
    return { ok: true, data: null };
  } catch (error) {
    return failure(error);
  }
}

/** Disconnect: the tokens go, the events read in leave Gradus, Gradus's own stay. */
export async function disconnectCalendar(connectionId: string): Promise<SyncActionResult<null>> {
  if (!z.uuid().safeParse(connectionId).success) return { ok: false, error: "invalid" };
  // Anyone may disconnect what they have, even after the switch stopped letting them in.
  const userId = await sessionUserId();
  if (!userId) return { ok: false, error: "unauthenticated" };
  const admin = createAdminClient();
  try {
    const { data } = await admin
      .from("calendar_connections")
      .select("provider")
      .eq("id", connectionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return { ok: false, error: "notFound" };
    await disconnectConnection(admin, userId, connectionId);
    await track(
      "calendar_sync_disconnected",
      { provider: providerKeyOf(data.provider) },
      { admin, userId },
    ).catch(() => undefined);
    return { ok: true, data: null };
  } catch (error) {
    return failure(error);
  }
}
