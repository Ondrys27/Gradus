import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { track } from "@/lib/analytics/track";
import type { Database } from "@/types/database";
import type { ProviderKey, RemoteCalendar } from "../types";
import { sealConnectionSecret, type ConnectionSecret } from "./connections";

type Admin = SupabaseClient<Database>;

/**
 * A connection made or made again (Google's callback, Apple's form): the
 * secret sealed, the provider's calendars listed. The first time, the
 * primary calendar (or the first one that can be written) is read and
 * written to, unless the person already writes elsewhere; the person
 * changes it in Settings → Calendar.
 */

/** Which calendar starts as the one read and written. */
export function defaultCalendar(calendars: RemoteCalendar[]): RemoteCalendar | null {
  return (
    calendars.find((calendar) => calendar.isPrimary && calendar.canWrite) ??
    calendars.find((calendar) => calendar.canWrite) ??
    null
  );
}

export async function saveConnection(
  admin: Admin,
  input: {
    userId: string;
    provider: ProviderKey;
    accountLabel: string | null;
    secret: ConnectionSecret;
    calendars: RemoteCalendar[];
  },
): Promise<{ connectionId: string; created: boolean }> {
  const { userId, provider } = input;
  const { data: existing, error: readError } = await admin
    .from("calendar_connections")
    .select("id")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  if (readError) throw readError;

  let connectionId = existing?.id ?? null;
  if (connectionId) {
    const { error } = await admin
      .from("calendar_connections")
      .update({
        secret_cipher: sealConnectionSecret(input.secret),
        account_label: input.accountLabel,
        status: "active",
        last_error: null,
      })
      .eq("id", connectionId)
      .eq("user_id", userId);
    if (error) throw error;
  } else {
    // The guard asks calendar_sync_allowed() again: no connection for an account outside the switch.
    const { data, error } = await admin
      .from("calendar_connections")
      .insert({
        user_id: userId,
        provider,
        account_label: input.accountLabel,
        secret_cipher: sealConnectionSecret(input.secret),
      })
      .select("id")
      .single();
    if (error) throw error;
    connectionId = data.id;
  }

  const { data: known, error: knownError } = await admin
    .from("calendar_connection_calendars")
    .select("id, external_id")
    .eq("connection_id", connectionId)
    .limit(500);
  if (knownError) throw knownError;
  const knownIds = new Map((known ?? []).map((row) => [row.external_id, row.id]));

  const { data: writing } = await admin
    .from("calendar_connection_calendars")
    .select("id")
    .eq("user_id", userId)
    .eq("write", true)
    .maybeSingle();
  const first = !existing ? defaultCalendar(input.calendars) : null;

  for (const calendar of input.calendars.slice(0, 200)) {
    const id = knownIds.get(calendar.externalId);
    if (id) {
      const { error } = await admin
        .from("calendar_connection_calendars")
        .update({ name: calendar.name, is_primary: calendar.isPrimary, can_write: calendar.canWrite })
        .eq("id", id);
      // A calendar that lost its write access stops being written to.
      if (error?.code === "23514") {
        await admin
          .from("calendar_connection_calendars")
          .update({ name: calendar.name, is_primary: calendar.isPrimary, can_write: false, write: false })
          .eq("id", id);
      } else if (error) throw error;
      knownIds.delete(calendar.externalId);
      continue;
    }
    const isFirst = first?.externalId === calendar.externalId;
    const { error } = await admin.from("calendar_connection_calendars").insert({
      connection_id: connectionId,
      user_id: userId,
      external_id: calendar.externalId,
      name: calendar.name,
      is_primary: calendar.isPrimary,
      can_write: calendar.canWrite,
      read: isFirst,
      write: isFirst && !writing,
    });
    if (error) throw error;
  }
  // Calendars the account no longer has: their events leave Gradus.
  for (const [, id] of knownIds) {
    await admin.rpc("calendar_sync_forget", { _connection: connectionId, _calendar: id });
    await admin.from("calendar_connection_calendars").delete().eq("id", id);
  }

  await track(
    "calendar_sync_connected",
    { provider, calendars: Math.min(input.calendars.length, 500) },
    { admin, userId },
  ).catch(() => undefined);
  return { connectionId, created: !existing };
}
