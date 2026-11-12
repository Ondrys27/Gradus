"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { useWorkspaceId } from "@/features/account/workspace-queries";
import { createClient } from "@/lib/supabase/client";
import type { IsoDate } from "@/lib/format";
import { dayRangeToInstants } from "./calendar-logic";
import { createEvent, deleteEvent, toEventRow, updateEvent } from "./ops";
import type { EventInput } from "./schemas";
import { clientOps } from "@/lib/ops-client";
import { EVENT_COLUMNS, type CalendarEvent, type MirrorItem } from "./types";

/** Bounds one period; a month never holds this many. */
const EVENT_LIMIT = 1000;
const MIRROR_LIMIT = 500;

export const calendarKeys = {
  all: (userId: string) => ["calendar", userId] as const,
  events: (userId: string, from: string, to: string) =>
    ["calendar", userId, "events", from, to] as const,
  mirrors: (userId: string, firstDay: IsoDate, lastDay: IsoDate) =>
    ["calendar", userId, "mirrors", firstDay, lastDay] as const,
};

/** Events overlapping the shown days; nothing outside the period is loaded. */
export function useCalendarEvents(
  firstDay: IsoDate,
  lastDay: IsoDate,
  timeZone: string,
  enabled: boolean,
) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const { from, to } = dayRangeToInstants(firstDay, lastDay, timeZone);
  return useQuery({
    queryKey: calendarKeys.events(user.id, from, to),
    enabled,
    // Moving between periods keeps the last one on screen instead of flashing empty.
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<CalendarEvent[]> => {
      // ends_at is never before starts_at, so either bound reaching into the
      // period means the event overlaps it; a missing end falls back to the start.
      const { data, error } = await createClient()
        .from("calendar_events")
        .select(EVENT_COLUMNS)
        .eq("user_id", workspaceId)
        .lt("starts_at", to)
        .or(`ends_at.gte.${from},starts_at.gte.${from}`)
        .order("starts_at")
        .limit(EVENT_LIMIT);
      if (error) throw error;
      return data;
    },
  });
}

/** Tasks with a due date and deals with a Close Date in the shown days. */
export function useMirrors(
  firstDay: IsoDate,
  lastDay: IsoDate,
  wanted: { tasks: boolean; deals: boolean },
  enabled: boolean,
) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: [...calendarKeys.mirrors(user.id, firstDay, lastDay), wanted.tasks, wanted.deals],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<MirrorItem[]> => {
      const supabase = createClient();
      const [tasks, deals] = await Promise.all([
        wanted.tasks
          ? supabase
              .from("tasks")
              .select("id, title, due_date, milestone_id")
              .eq("user_id", workspaceId)
              .neq("status", "done")
              .gte("due_date", firstDay)
              .lte("due_date", lastDay)
              .order("due_date")
              .limit(MIRROR_LIMIT)
          : null,
        wanted.deals
          ? supabase
              .from("deals")
              .select("id, title, expected_close_date")
              .eq("user_id", workspaceId)
              .is("won_at", null)
              .is("lost_at", null)
              .gte("expected_close_date", firstDay)
              .lte("expected_close_date", lastDay)
              .order("expected_close_date")
              .limit(MIRROR_LIMIT)
          : null,
      ]);
      if (tasks?.error) throw tasks.error;
      if (deals?.error) throw deals.error;
      return [
        ...(tasks?.data ?? []).map((task): MirrorItem => ({
          id: task.id,
          source: "task",
          title: task.title,
          date: task.due_date!,
          href: `/app/milniky/${task.milestone_id}`,
        })),
        ...(deals?.data ?? []).map((deal): MirrorItem => ({
          id: deal.id,
          source: "deal",
          title: deal.title,
          date: deal.expected_close_date!,
          href: `/app/pipeline?deal=${deal.id}`,
        })),
      ];
    },
  });
}

const toRow = toEventRow;

/** The kind of an event already on screen (a drag sends only the new time). */
function findKind(queryClient: QueryClient, userId: string, id: string) {
  for (const [, events] of queryClient.getQueriesData<CalendarEvent[]>({
    queryKey: [...calendarKeys.all(userId), "events"],
  })) {
    const found = events?.find((event) => event.id === id);
    if (found) return found.kind;
  }
  return null;
}

export function useCreateEvent() {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: EventInput) => {
      await createEvent(clientOps(), { workspaceId, input });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: calendarKeys.all(user.id) }),
  });
}

type Snapshot = [readonly unknown[], CalendarEvent[] | undefined][];

/**
 * Saves changes to an event. `patch` may be a bare time range (a drag): the
 * screen moves at once and goes back if the save fails.
 */
export function useUpdateEvent() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ReturnType<typeof toRow>> }) =>
      updateEvent(clientOps(), { id, patch, kind: findKind(queryClient, user.id, id) }),
    onMutate: async ({ id, patch }): Promise<{ snapshot: Snapshot }> => {
      const filter = { queryKey: [...calendarKeys.all(user.id), "events"] };
      await queryClient.cancelQueries(filter);
      const snapshot = queryClient.getQueriesData<CalendarEvent[]>(filter);
      queryClient.setQueriesData<CalendarEvent[]>(filter, (events) =>
        events?.map((event) => (event.id === id ? { ...event, ...patch } : event)),
      );
      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      for (const [key, data] of context?.snapshot ?? []) queryClient.setQueryData(key, data);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: calendarKeys.all(user.id) }),
  });
}

/** Deleting an event never touches the contact or the deal it points to. */
export function useDeleteEvent() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteEvent(clientOps(), id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: calendarKeys.all(user.id) }),
  });
}

export { toRow as eventToRow };
