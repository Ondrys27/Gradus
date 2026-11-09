import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { pickEventType, type LinkPurpose } from "../event-type-form";
import { bookingUrl } from "../handle";

/**
 * The booking link Jarvis offers ("send a link to book a meeting"): the
 * person's own profile in the space and the best of their active types for
 * the purpose. Read with the user's own client, so RLS decides; null without
 * a profile or an active type.
 */
export type BookingLink = { name: string; durationMin: number; url: string };

export async function loadBookingLink(
  supabase: SupabaseClient<Database>,
  userId: string,
  spaceId: string,
  purpose: LinkPurpose,
  origin: string,
): Promise<BookingLink | null> {
  const { data: profile, error } = await supabase
    .from("scheduler_profiles")
    .select("id, handle")
    .eq("user_id", userId)
    .eq("space_id", spaceId)
    .maybeSingle();
  if (error || !profile) return null;
  const { data: types } = await supabase
    .from("event_types")
    .select("id, slug, name, duration_min, active, position")
    .eq("profile_id", profile.id)
    .eq("active", true)
    .limit(50);
  const best = pickEventType(types ?? [], purpose);
  if (!best) return null;
  return {
    name: best.name,
    durationMin: best.duration_min,
    url: bookingUrl(origin, profile.handle, best.slug),
  };
}

/** The site's address for links outside a request (the morning brief) too. */
export function linkOrigin(requestOrigin?: string | null): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || requestOrigin || "").replace(/\/+$/, "");
}
