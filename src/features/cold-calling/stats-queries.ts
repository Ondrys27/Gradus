"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import type { IsoDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useFormatSettings } from "@/lib/use-format-settings";
import type { StatRow } from "./heatmap-logic";
import type { Range } from "./stats-logic";

export const statsKeys = {
  seconds: (userId: string, range: Range, timeZone: string, actor: string | null) =>
    ["cold-calling", userId, "stats", "seconds", range.from, range.to, timeZone, actor] as const,
  meetings: (userId: string, range: Range, timeZone: string, actor: string | null) =>
    ["cold-calling", userId, "stats", "meetings", range.from, range.to, timeZone, actor] as const,
};

/**
 * Seconds on the phone per day, day-clipped in the user's zone by the database.
 * The owner sees the whole space (`actor` null) or one person; a worker always
 * gets only their own, whatever is asked.
 */
export function useDailySeconds(range: Range, actor: string | null = null) {
  const { user } = useSession();
  const { timeZone } = useFormatSettings();
  return useQuery({
    queryKey: statsKeys.seconds(user.id, range, timeZone, actor),
    queryFn: async (): Promise<Map<IsoDate, number>> => {
      const { data, error } = await createClient().rpc("prospecting_daily_seconds", {
        _from: range.from,
        _to: range.to,
        _timezone: timeZone,
        _actor: actor ?? undefined,
      });
      if (error) throw error;
      return new Map(data.map((row) => [row.day, row.seconds]));
    },
  });
}

/** Meetings booked per day: moves into the table with the system key meeting_scheduled. */
export function useDailyMeetings(range: Range, actor: string | null = null) {
  const { user } = useSession();
  const { timeZone } = useFormatSettings();
  return useQuery({
    queryKey: statsKeys.meetings(user.id, range, timeZone, actor),
    queryFn: async (): Promise<Map<IsoDate, number>> => {
      const { data, error } = await createClient().rpc("meetings_daily", {
        _from: range.from,
        _to: range.to,
        _timezone: timeZone,
        _actor: actor ?? undefined,
      });
      if (error) throw error;
      return new Map(data.map((row) => [row.day, row.meetings]));
    },
  });
}

/**
 * The shared "best time to call" statistics of a country: no user data, read
 * by every signed-in user, rebuilt once a day. Also feeds Jarvis's time window.
 */
export function useCallTimeStats(country: string | null) {
  return useQuery({
    queryKey: ["call-time-stats", country],
    enabled: country !== null,
    // Rebuilt once a day.
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<StatRow[]> => {
      const { data, error } = await createClient()
        .from("call_time_stats")
        .select("day_of_week, hour, attempts, meetings")
        .eq("country_code", country ?? "")
        .limit(24 * 7);
      if (error) throw error;
      return data;
    },
  });
}
