import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { MAX_SOURCE_CALENDARS, parseCalendarSources } from "../calendar-sources";

type Admin = SupabaseClient<Database>;

/**
 * A calendar connected from the scheduler's Availability (30.4) counts for
 * the scheduler at once: the calendars the new connection reads are added to
 * the busy sources of the person's scheduler profiles (in every company).
 * A profile from before 30.4 (no sources stored) reads every calendar anyway.
 */
export async function addConnectionToScheduler(
  admin: Admin,
  userId: string,
  connectionId: string,
): Promise<void> {
  const { data: calendars, error } = await admin
    .from("calendar_connection_calendars")
    .select("id")
    .eq("connection_id", connectionId)
    .eq("user_id", userId)
    .eq("read", true)
    .limit(50);
  if (error) throw error;
  const ids = (calendars ?? []).map((row) => row.id);
  if (!ids.length) return;
  const { data: profiles, error: profilesError } = await admin
    .from("scheduler_profiles")
    .select("id, calendar_sources")
    .eq("user_id", userId)
    .limit(100);
  if (profilesError) throw profilesError;
  for (const profile of profiles ?? []) {
    const sources = parseCalendarSources(profile.calendar_sources);
    if (!sources) continue;
    const next = {
      ...sources,
      calendars: [...new Set([...sources.calendars, ...ids])].slice(0, MAX_SOURCE_CALENDARS),
    };
    const { error: updateError } = await admin
      .from("scheduler_profiles")
      .update({ calendar_sources: next as unknown as Json })
      .eq("id", profile.id)
      .eq("user_id", userId);
    if (updateError) console.error("[scheduler] sources update failed", updateError.code);
  }
}
