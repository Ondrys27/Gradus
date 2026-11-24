"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { useWorkspaceId } from "@/features/account/workspace-queries";
import { createClient } from "@/lib/supabase/client";
import { ACTIVITY_PAGE, type ActivityKind, type ActivityRow, type DailyRow } from "./activity";

/**
 * Activity of the company, read only through activity_feed() and
 * activity_daily() with the viewer's own client: the database shows the
 * people the viewer may see and blanks what they may not read.
 */
export const activityKeys = {
  all: (userId: string) => ["activity", userId] as const,
  feed: (userId: string, space: string, args: unknown) =>
    ["activity", userId, space, "feed", args] as const,
  daily: (userId: string, space: string, args: unknown) =>
    ["activity", userId, space, "daily", args] as const,
};

export type FeedArgs = {
  from: string;
  until: string;
  actors: string[] | null;
  kinds: ActivityKind[] | null;
};

export function useActivityFeed(args: FeedArgs, enabled = true) {
  const { user } = useSession();
  const space = useWorkspaceId();
  return useInfiniteQuery({
    queryKey: activityKeys.feed(user.id, space, args),
    enabled: enabled && (args.actors === null || args.actors.length > 0),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<ActivityRow[]> => {
      const { data, error } = await createClient().rpc("activity_feed", {
        _space: space,
        _from: args.from,
        _until: args.until,
        ...(args.actors ? { _actors: args.actors } : {}),
        ...(args.kinds ? { _kinds: args.kinds } : {}),
        ...(pageParam ? { _before: pageParam } : {}),
        _limit: ACTIVITY_PAGE,
      });
      if (error) throw error;
      return data;
    },
    getNextPageParam: (last) =>
      last.length === ACTIVITY_PAGE ? (last[last.length - 1]?.created_at ?? null) : null,
  });
}

export function useActivityDaily(
  args: { from: string; until: string; timeZone: string; actors: string[] | null },
  enabled = true,
) {
  const { user } = useSession();
  const space = useWorkspaceId();
  return useQuery({
    queryKey: activityKeys.daily(user.id, space, args),
    enabled: enabled && (args.actors === null || args.actors.length > 0),
    queryFn: async (): Promise<DailyRow[]> => {
      const { data, error } = await createClient().rpc("activity_daily", {
        _space: space,
        _from: args.from,
        _until: args.until,
        _tz: args.timeZone,
        ...(args.actors ? { _actors: args.actors } : {}),
      });
      if (error) throw error;
      return data;
    },
  });
}
