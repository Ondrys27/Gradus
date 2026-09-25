"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import type { IsoDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useFormatSettings } from "@/lib/use-format-settings";
import type { Range } from "./stats-logic";

export const statsKeys = {
  seconds: (userId: string, range: Range, timeZone: string) =>
    ["cold-calling", userId, "stats", "seconds", range.from, range.to, timeZone] as const,
  meetings: (userId: string, range: Range, timeZone: string) =>
    ["cold-calling", userId, "stats", "meetings", range.from, range.to, timeZone] as const,
};

/** Seconds on the phone per day, day-clipped in the user's zone by the database. */
export function useDailySeconds(range: Range) {
  const { user } = useSession();
  const { timeZone } = useFormatSettings();
  return useQuery({
    queryKey: statsKeys.seconds(user.id, range, timeZone),
    queryFn: async (): Promise<Map<IsoDate, number>> => {
      const { data, error } = await createClient().rpc("prospecting_daily_seconds", {
        _from: range.from,
        _to: range.to,
        _timezone: timeZone,
      });
      if (error) throw error;
      return new Map(data.map((row) => [row.day, row.seconds]));
    },
  });
}

/** Meetings booked per day: moves into the table with the system key meeting_scheduled. */
export function useDailyMeetings(range: Range) {
  const { user } = useSession();
  const { timeZone } = useFormatSettings();
  return useQuery({
    queryKey: statsKeys.meetings(user.id, range, timeZone),
    queryFn: async (): Promise<Map<IsoDate, number>> => {
      const { data, error } = await createClient().rpc("meetings_daily", {
        _from: range.from,
        _to: range.to,
        _timezone: timeZone,
      });
      if (error) throw error;
      return new Map(data.map((row) => [row.day, row.meetings]));
    },
  });
}
