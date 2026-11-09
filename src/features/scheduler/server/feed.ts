import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { buildIcsFeed, type FeedEvent } from "../ics/export";

/**
 * The account's Gradus calendar as an ICS feed (Settings → Calendar → "Link
 * to subscribe"), for Google or Apple to read. The address carries a random
 * secret; only its SHA-256 is stored. Read with the admin client for exactly
 * that account: the events of its own space and, in the companies it works
 * for now, the events it made itself. No sample data of the tutorial.
 */

type Admin = SupabaseClient<Database>;

const DAY = 86_400_000;
const PAST_DAYS = 30;
const AHEAD_DAYS = 180;
const LIMIT = 2000;

export function feedTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A token as it appears in the address: 43 base64url characters, an optional ".ics". */
export function parseFeedToken(segment: string): string | null {
  const token = segment.replace(/\.ics$/i, "");
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export async function feedOwner(admin: Admin, token: string): Promise<string | null> {
  const { data, error } = await admin
    .from("calendar_feed_tokens")
    .select("user_id, last_used_at")
    .eq("token_hash", feedTokenHash(token))
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // Calendars poll often; one write an hour is enough to tell the link is in use.
  if (!data.last_used_at || Date.now() - Date.parse(data.last_used_at) > 3_600_000) {
    await admin
      .from("calendar_feed_tokens")
      .update({ last_used_at: new Date().toISOString() })
      .eq("user_id", data.user_id);
  }
  return data.user_id;
}

export async function buildAccountFeed(
  admin: Admin,
  userId: string,
  name: string,
  now = Date.now(),
) {
  const { data: memberships, error: membershipError } = await admin
    .from("memberships")
    .select("space_id")
    .eq("user_id", userId)
    .eq("role", "worker")
    .eq("status", "active")
    .limit(100);
  if (membershipError) throw membershipError;
  const companies = (memberships ?? [])
    .map((row) => row.space_id)
    .filter((space) => space !== userId);
  const from = new Date(now - PAST_DAYS * DAY).toISOString();
  const to = new Date(now + AHEAD_DAYS * DAY).toISOString();
  const columns = "id, title, description, location, starts_at, ends_at, all_day, updated_at";
  const own = admin
    .from("calendar_events")
    .select(columns)
    .eq("user_id", userId)
    .eq("is_demo", false)
    .gte("starts_at", from)
    .lt("starts_at", to)
    .order("starts_at")
    .limit(LIMIT);
  const theirs = companies.length
    ? admin
        .from("calendar_events")
        .select(columns)
        .in("user_id", companies)
        .eq("actor_id", userId)
        .eq("is_demo", false)
        .gte("starts_at", from)
        .lt("starts_at", to)
        .order("starts_at")
        .limit(LIMIT)
    : null;
  const [ownResult, theirResult, settings] = await Promise.all([
    own,
    theirs,
    admin.from("user_settings").select("timezone").eq("user_id", userId).maybeSingle(),
  ]);
  if (ownResult.error) throw ownResult.error;
  if (theirResult?.error) throw theirResult.error;
  const events: FeedEvent[] = [...(ownResult.data ?? []), ...(theirResult?.data ?? [])].map(
    (event) => ({
      uid: `${event.id}@calendar`,
      title: event.title,
      start: event.starts_at,
      end: event.ends_at,
      allDay: event.all_day,
      description: event.description,
      location: event.location,
      updatedAt: event.updated_at,
    }),
  );
  return buildIcsFeed({
    name,
    events,
    now: new Date(now),
    timeZone: settings.data?.timezone ?? "UTC",
  });
}
