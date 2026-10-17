import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StatRow } from "@/features/cold-calling/heatmap-logic";
import type { Database } from "@/types/database";
import { timeWindow, type TimeWindow } from "../time-window";

type Client = SupabaseClient<Database>;

/** One week of hours: everything a country can have. */
const STATS_LIMIT = 24 * 7;

/**
 * The shared call statistics of a country. They hold no user data, so the
 * user's client (every signed-in user may read them) and the cron's admin
 * client read the same thing. A failure only means the default hours apply.
 */
export async function loadCallStats(client: Client, country: string | null): Promise<StatRow[]> {
  if (!country) return [];
  try {
    const { data, error } = await client
      .from("call_time_stats")
      .select("day_of_week, hour, attempts, meetings")
      .eq("country_code", country)
      .limit(STATS_LIMIT);
    if (error) throw error;
    return data ?? [];
  } catch (error) {
    console.error("jarvis call stats failed", error);
    return [];
  }
}

/** What fits now for this user: their zone, country and their country's call results. */
export async function loadTimeWindow(
  client: Client,
  args: { timeZone: string; country: string | null; now?: Date },
): Promise<TimeWindow> {
  const stats = await loadCallStats(client, args.country);
  return timeWindow({
    now: args.now ?? new Date(),
    timeZone: args.timeZone,
    country: args.country,
    stats,
  });
}
