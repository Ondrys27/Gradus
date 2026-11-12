import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { SchedulerSituation } from "../situation";
import { linkOrigin, loadBookingLink } from "./link";

const DAY = 86_400_000;
const UPCOMING_DAYS = 7;
const UPCOMING_LIMIT = 5;

/**
 * What Grady knows of the person's scheduler: bookings of the next seven
 * days, those waiting for approval, and the link to send for a first call.
 * Read with the user's own client (RLS); never fails the rest of the
 * situation, so a problem reads as null.
 */
export async function loadSchedulerSituation(
  supabase: SupabaseClient<Database>,
  userId: string,
  spaceId: string,
  now: Date,
): Promise<SchedulerSituation | null> {
  try {
    const from = now.toISOString();
    const to = new Date(now.getTime() + UPCOMING_DAYS * DAY).toISOString();
    const [upcoming, pending, link] = await Promise.all([
      supabase
        .from("bookings")
        .select("starts_at, guest_name, status, event_type_id", { count: "exact" })
        .eq("space_id", spaceId)
        .eq("host_user_id", userId)
        .in("status", ["pending", "confirmed"])
        .gte("starts_at", from)
        .lt("starts_at", to)
        .order("starts_at")
        .limit(UPCOMING_LIMIT),
      supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("space_id", spaceId)
        .eq("host_user_id", userId)
        .eq("status", "pending")
        .gte("starts_at", from),
      loadBookingLink(supabase, userId, spaceId, "intro", linkOrigin()),
    ]);
    if (upcoming.error || pending.error) return null;
    const typeIds = [
      ...new Set((upcoming.data ?? []).map((row) => row.event_type_id).filter(Boolean)),
    ] as string[];
    const names = new Map<string, string>();
    if (typeIds.length) {
      const { data } = await supabase.from("event_types").select("id, name").in("id", typeIds);
      for (const row of data ?? []) names.set(row.id, row.name);
    }
    return {
      upcoming: (upcoming.data ?? []).map((row) => ({
        startsAt: new Date(row.starts_at),
        guest: row.guest_name ?? "",
        type: row.event_type_id ? (names.get(row.event_type_id) ?? null) : null,
        pending: row.status === "pending",
      })),
      upcomingTotal: upcoming.count ?? 0,
      pendingTotal: pending.count ?? 0,
      link,
    };
  } catch {
    return null;
  }
}
