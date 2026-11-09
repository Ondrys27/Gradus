"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/features/account/workspace-queries";
import { track } from "@/lib/analytics/client";
import { createClient } from "@/lib/supabase/client";
import {
  addCalendarSubscription,
  calendarFeedState,
  createCalendarFeed,
  ensureSchedulerSetup,
  refreshCalendarSubscription,
  revokeCalendarFeed,
  type SchedulerActionResult,
  type SchedulerError,
} from "./actions";
import { draftToRow, toEventType, type EventTypeDraft } from "./event-type-form";
import type { PresetKey } from "./presets";
import type { GuestDay } from "./slots";
import {
  BOOKING_COLUMNS,
  EVENT_TYPE_COLUMNS,
  OVERRIDE_COLUMNS,
  PROFILE_COLUMNS,
  RULE_COLUMNS,
  SUBSCRIPTION_COLUMNS,
  type AvailabilityOverride,
  type AvailabilityRule,
  type BookingRow,
  type CalendarSubscription,
  type EventType,
  type EventTypeRow,
  type SchedulerProfile,
} from "./types";

/**
 * The scheduler's reads and writes in the browser. Everything goes through
 * the user's own client and RLS: the person's own profile, types and hours in
 * the active space, and for the space's owner everyone's (read only, a type
 * may be switched off). Secrets (ICS links, the feed token) go through the
 * server actions.
 */

const BOOKINGS_PAGE = 25;
const TEAM_LIMIT = 500;

export const schedulerKeys = {
  all: (userId: string) => ["scheduler", userId] as const,
  profile: (userId: string, space: string) => ["scheduler", userId, "profile", space] as const,
  types: (userId: string, profile: string) => ["scheduler", userId, "types", profile] as const,
  availability: (userId: string, profile: string) =>
    ["scheduler", userId, "availability", profile] as const,
  counts: (userId: string, space: string) => ["scheduler", userId, "counts", space] as const,
  limit: (userId: string, space: string) => ["scheduler", userId, "limit", space] as const,
  bookings: (
    userId: string,
    space: string,
    scope: string,
    when: string,
    status: string,
    page: number,
  ) => ["scheduler", userId, "bookings", space, scope, when, status, page] as const,
  team: (userId: string, space: string) => ["scheduler", userId, "team", space] as const,
  preview: (userId: string, type: string, zone: string) =>
    ["scheduler", userId, "preview", type, zone] as const,
  subscriptions: (userId: string) => ["scheduler", userId, "subscriptions"] as const,
  busy: (userId: string) => ["scheduler", userId, "subscriptions", "busy"] as const,
  feed: (userId: string) => ["scheduler", userId, "feed"] as const,
};

function must<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw result.error;
  return result.data;
}

/** A failed write as the screens name it: the plan's limit, read-only, or something else. */
export type WriteProblem =
  "planLimit" | "readOnly" | "slugTaken" | "handleTaken" | "invalid" | "unknown";

export function writeProblem(error: unknown): WriteProblem {
  const { message, code } = (error ?? {}) as { message?: string; code?: string };
  if (message?.includes("scheduler_type_limit")) return "planLimit";
  if (message?.includes("read_only")) return "readOnly";
  if (code === "23505" && message?.includes("event_types_profile_id_slug")) return "slugTaken";
  if (code === "23505" && message?.includes("handle")) return "handleTaken";
  if (code === "23514" || code === "22P02" || code === "22023") return "invalid";
  return "unknown";
}

async function unwrap<T>(promise: Promise<SchedulerActionResult<T>>): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new SchedulerActionError(result.error);
  return result.data;
}

export class SchedulerActionError extends Error {
  constructor(readonly code: SchedulerError) {
    super(code);
  }
}

// ---------------------------------------------------------------------------
// Profile and setup
// ---------------------------------------------------------------------------

/** The signed-in person's profile in the active space; null until the first setup. */
export function useSchedulerProfile(enabled = true) {
  const workspace = useWorkspace();
  return useQuery({
    queryKey: schedulerKeys.profile(workspace.userId, workspace.id),
    enabled,
    queryFn: async () =>
      must(
        await createClient()
          .from("scheduler_profiles")
          .select(PROFILE_COLUMNS)
          .eq("user_id", workspace.userId)
          .eq("space_id", workspace.id)
          .maybeSingle(),
      ) as SchedulerProfile | null,
  });
}

export function useEnsureSetup() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (names: Record<PresetKey, string>) => unwrap(ensureSchedulerSetup({ names })),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: schedulerKeys.all(workspace.userId) }),
  });
}

export type ProfilePatch = Partial<
  Pick<
    SchedulerProfile,
    "handle" | "display_name" | "headline" | "bio" | "time_zone" | "video_link" | "setup_done_at"
  >
>;

export function useUpdateProfile(profileId: string | undefined) {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: ProfilePatch) => {
      if (!profileId) throw new Error("no profile");
      const { error } = await createClient()
        .from("scheduler_profiles")
        .update(patch)
        .eq("id", profileId)
        .eq("user_id", workspace.userId);
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: schedulerKeys.profile(workspace.userId, workspace.id),
      }),
  });
}

/** Whether a handle is free (another person's or another profile of the caller's is taken). */
export async function handleAvailable(handle: string, profileId?: string): Promise<boolean> {
  const { data, error } = await createClient().rpc("scheduler_handle_available", {
    _handle: handle,
    ...(profileId ? { _profile: profileId } : {}),
  });
  if (error) throw error;
  return data === true;
}

/** Active meeting types the plan of the space allows each person; null = no limit. */
export function useTypesLimit() {
  const workspace = useWorkspace();
  return useQuery({
    queryKey: schedulerKeys.limit(workspace.userId, workspace.id),
    queryFn: async () => {
      const { data, error } = await createClient().rpc("scheduler_types_limit", {
        _space: workspace.id,
      });
      if (error) throw error;
      return typeof data === "number" ? data : null;
    },
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Meeting types
// ---------------------------------------------------------------------------

export function useEventTypes(profileId: string | undefined) {
  const workspace = useWorkspace();
  return useQuery({
    queryKey: schedulerKeys.types(workspace.userId, profileId ?? ""),
    enabled: Boolean(profileId),
    queryFn: async () =>
      (
        must(
          await createClient()
            .from("event_types")
            .select(EVENT_TYPE_COLUMNS)
            .eq("profile_id", profileId!)
            .order("position")
            .order("created_at")
            .limit(100),
        ) as EventTypeRow[]
      ).map(toEventType),
  });
}

/** Bookings of the last 30 days per meeting type, of what the account may see. */
export function useBookingCounts() {
  const workspace = useWorkspace();
  return useQuery({
    queryKey: schedulerKeys.counts(workspace.userId, workspace.id),
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data, error } = await createClient().rpc("scheduler_booking_counts", {
        _since: since,
      });
      if (error) throw error;
      return new Map((data ?? []).map((row) => [row.event_type_id, row.bookings]));
    },
  });
}

function invalidateTypes(queryClient: QueryClient, userId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: [...schedulerKeys.all(userId), "types"] }),
    queryClient.invalidateQueries({ queryKey: [...schedulerKeys.all(userId), "team"] }),
    queryClient.invalidateQueries({ queryKey: [...schedulerKeys.all(userId), "preview"] }),
  ]);
}

export function useCreateEventType(profileId: string | undefined) {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      draft: EventTypeDraft;
      position: number;
      active: boolean;
      preset: boolean;
    }) => {
      if (!profileId) throw new Error("no profile");
      const row = await createClient()
        .from("event_types")
        .insert({
          ...draftToRow(input.draft),
          profile_id: profileId,
          // The guard takes person and space from the profile; these only satisfy the types.
          user_id: workspace.userId,
          space_id: workspace.id,
          position: input.position,
          active: input.active,
        })
        .select(EVENT_TYPE_COLUMNS)
        .single();
      if (row.error) throw row.error;
      track("scheduler_event_type_created", {
        duration: Math.min(480, input.draft.duration_min),
        location: input.draft.location_kind,
        approval: input.draft.requires_approval,
        preset: input.preset,
      });
      return toEventType(row.data as EventTypeRow);
    },
    onSettled: () => invalidateTypes(queryClient, workspace.userId),
  });
}

export function useUpdateEventType() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      draft: EventTypeDraft;
      tab: Parameters<typeof trackUpdate>[0];
    }) => {
      const { error } = await createClient()
        .from("event_types")
        .update(draftToRow(input.draft))
        .eq("id", input.id)
        .eq("user_id", workspace.userId);
      if (error) throw error;
      trackUpdate(input.tab);
    },
    onSettled: () => invalidateTypes(queryClient, workspace.userId),
  });
}

function trackUpdate(
  tab: "basics" | "availability" | "questions" | "reminders" | "confirmation" | "preview",
) {
  track("scheduler_event_type_updated", { tab });
}

/** On or off; the space's owner may switch somebody else's type off (never on). */
export function useToggleEventType() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { type: Pick<EventType, "id" | "user_id">; active: boolean }) => {
      const { data, error } = await createClient()
        .from("event_types")
        .update({ active: input.active })
        .eq("id", input.type.id)
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("not changed");
      track("scheduler_event_type_toggled", {
        active: input.active,
        by_owner: input.type.user_id !== workspace.userId,
      });
    },
    onError: (error) => {
      if (writeProblem(error) === "planLimit") track("scheduler_plan_limit_hit", {});
    },
    onSettled: () => invalidateTypes(queryClient, workspace.userId),
  });
}

export function useDeleteEventType() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await createClient()
        .from("event_types")
        .delete()
        .eq("id", id)
        .eq("user_id", workspace.userId);
      if (error) throw error;
      track("scheduler_event_type_deleted", {});
    },
    onSettled: () => invalidateTypes(queryClient, workspace.userId),
  });
}

// ---------------------------------------------------------------------------
// Hours and exceptions
// ---------------------------------------------------------------------------

export type Availability = { rules: AvailabilityRule[]; overrides: AvailabilityOverride[] };

export function useAvailability(profileId: string | undefined) {
  const workspace = useWorkspace();
  return useQuery({
    queryKey: schedulerKeys.availability(workspace.userId, profileId ?? ""),
    enabled: Boolean(profileId),
    queryFn: async (): Promise<Availability> => {
      const supabase = createClient();
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const [rules, overrides] = await Promise.all([
        supabase
          .from("availability_rules")
          .select(RULE_COLUMNS)
          .eq("profile_id", profileId!)
          .order("weekday")
          .order("start_time")
          .limit(500),
        supabase
          .from("availability_overrides")
          .select(OVERRIDE_COLUMNS)
          .eq("profile_id", profileId!)
          .gte("date", yesterday)
          .order("date")
          .order("start_time")
          .limit(500),
      ]);
      return { rules: must(rules) ?? [], overrides: must(overrides) ?? [] };
    },
  });
}

export type RuleInput = { weekday: number; start_time: string; end_time: string };

/**
 * Replaces the weekly hours of the profile (or of one meeting type): the
 * new ones go in first, the old ones out after, so a failure never leaves the
 * week empty.
 */
export function useSaveWeeklyRules(profileId: string | undefined) {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      eventTypeId: string | null;
      rules: RuleInput[];
      previous: string[];
    }) => {
      if (!profileId) throw new Error("no profile");
      const supabase = createClient();
      let added: string[] = [];
      if (input.rules.length) {
        const { data, error } = await supabase
          .from("availability_rules")
          .insert(
            input.rules.map((rule) => ({
              ...rule,
              profile_id: profileId,
              // The guard takes person and space from the profile; these only satisfy the types.
              user_id: workspace.userId,
              space_id: workspace.id,
              event_type_id: input.eventTypeId,
            })),
          )
          .select("id");
        if (error) throw error;
        added = (data ?? []).map((row) => row.id);
      }
      if (input.previous.length) {
        const { error } = await supabase
          .from("availability_rules")
          .delete()
          .in("id", input.previous);
        if (error) {
          if (added.length) await supabase.from("availability_rules").delete().in("id", added);
          throw error;
        }
      }
      track("scheduler_availability_saved", {
        scope: input.eventTypeId ? "type" : "profile",
        intervals: Math.min(500, input.rules.length),
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: schedulerKeys.availability(workspace.userId, profileId ?? ""),
      });
      void queryClient.invalidateQueries({
        queryKey: [...schedulerKeys.all(workspace.userId), "preview"],
      });
    },
  });
}

/** Exceptions for one or more dates: other hours, or the whole day blocked (both times null). */
export function useAddOverrides(profileId: string | undefined) {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      dates: string[];
      intervals: Array<{ start_time: string; end_time: string }> | null;
    }) => {
      if (!profileId) throw new Error("no profile");
      const supabase = createClient();
      // A date gets the new exception instead of what it had.
      const { error: clearError } = await supabase
        .from("availability_overrides")
        .delete()
        .eq("profile_id", profileId)
        .in("date", input.dates);
      if (clearError) throw clearError;
      const rows: Array<{
        profile_id: string;
        user_id: string;
        space_id: string;
        date: string;
        start_time: string | null;
        end_time: string | null;
      }> = input.dates.flatMap((date) =>
        (input.intervals ?? [{ start_time: null, end_time: null }]).map(
          (interval: { start_time: string | null; end_time: string | null }) => ({
            profile_id: profileId,
            // The guard takes person and space from the profile; these only satisfy the types.
            user_id: workspace.userId,
            space_id: workspace.id,
            date,
            start_time: interval.start_time,
            end_time: interval.end_time,
          }),
        ),
      );
      const { error } = await supabase.from("availability_overrides").insert(rows);
      if (error) throw error;
      track("scheduler_availability_saved", {
        scope: "override",
        intervals: Math.min(500, rows.length),
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: schedulerKeys.availability(workspace.userId, profileId ?? ""),
      });
      void queryClient.invalidateQueries({
        queryKey: [...schedulerKeys.all(workspace.userId), "preview"],
      });
    },
  });
}

export function useDeleteOverrides(profileId: string | undefined) {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dates: string[]) => {
      if (!profileId) throw new Error("no profile");
      const { error } = await createClient()
        .from("availability_overrides")
        .delete()
        .eq("profile_id", profileId)
        .in("date", dates);
      if (error) throw error;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: schedulerKeys.availability(workspace.userId, profileId ?? ""),
      });
      void queryClient.invalidateQueries({
        queryKey: [...schedulerKeys.all(workspace.userId), "preview"],
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export function usePreviewSlots(typeId: string | undefined, guestTimeZone: string) {
  const workspace = useWorkspace();
  return useQuery({
    queryKey: schedulerKeys.preview(workspace.userId, typeId ?? "", guestTimeZone),
    enabled: Boolean(typeId),
    queryFn: async (): Promise<{ timeZone: string; days: GuestDay[] }> => {
      const params = new URLSearchParams({ type: typeId!, tz: guestTimeZone });
      const response = await fetch(`/api/scheduler/preview?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`preview ${response.status}`);
      return response.json();
    },
  });
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

export type BookingScope = "mine" | "team";
export type BookingWhen = "upcoming" | "past";
export type BookingStatusFilter = "all" | "pending" | "confirmed" | "cancelled";

export function useBookings(filters: {
  scope: BookingScope;
  when: BookingWhen;
  status: BookingStatusFilter;
  page: number;
}) {
  const workspace = useWorkspace();
  return useQuery({
    queryKey: schedulerKeys.bookings(
      workspace.userId,
      workspace.id,
      filters.scope,
      filters.when,
      filters.status,
      filters.page,
    ),
    queryFn: async () => {
      const now = new Date().toISOString();
      let query = createClient()
        .from("bookings")
        .select(BOOKING_COLUMNS, { count: "exact" })
        .eq("space_id", workspace.id)
        .neq("status", "held");
      if (filters.scope === "mine") query = query.eq("host_user_id", workspace.userId);
      query = filters.when === "upcoming" ? query.gte("ends_at", now) : query.lt("ends_at", now);
      if (filters.status === "cancelled")
        query = query.in("status", ["cancelled", "declined", "rescheduled"]);
      else if (filters.status !== "all") query = query.eq("status", filters.status);
      const from = filters.page * BOOKINGS_PAGE;
      const result = await query
        .order("starts_at", { ascending: filters.when === "upcoming" })
        .range(from, from + BOOKINGS_PAGE - 1);
      if (result.error) throw result.error;
      return {
        rows: (result.data ?? []) as BookingRow[],
        total: result.count ?? 0,
        pageSize: BOOKINGS_PAGE,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Everyone of the company (the space's owner)
// ---------------------------------------------------------------------------

export type TeamProfile = SchedulerProfile & { name: string | null; types: EventType[] };

export function useTeamScheduler(enabled: boolean) {
  const workspace = useWorkspace();
  return useQuery({
    queryKey: schedulerKeys.team(workspace.userId, workspace.id),
    enabled,
    queryFn: async (): Promise<TeamProfile[]> => {
      const supabase = createClient();
      const [profiles, types, workers] = await Promise.all([
        supabase
          .from("scheduler_profiles")
          .select(PROFILE_COLUMNS)
          .eq("space_id", workspace.id)
          .limit(TEAM_LIMIT),
        supabase
          .from("event_types")
          .select(EVENT_TYPE_COLUMNS)
          .eq("space_id", workspace.id)
          .order("position")
          .limit(TEAM_LIMIT),
        supabase
          .from("workers")
          .select("user_id, name")
          .eq("owner_id", workspace.id)
          .limit(TEAM_LIMIT),
      ]);
      const names = new Map((must(workers) ?? []).map((row) => [row.user_id, row.name]));
      const byProfile = new Map<string, EventType[]>();
      for (const row of (must(types) ?? []) as EventTypeRow[]) {
        const list = byProfile.get(row.profile_id) ?? [];
        list.push(toEventType(row));
        byProfile.set(row.profile_id, list);
      }
      return ((must(profiles) ?? []) as SchedulerProfile[])
        .filter((profile) => profile.user_id !== workspace.userId)
        .map((profile) => ({
          ...profile,
          name: names.get(profile.user_id) ?? profile.display_name,
          types: byProfile.get(profile.id) ?? [],
        }))
        .sort((a, b) => (a.name ?? a.handle).localeCompare(b.name ?? b.handle));
    },
  });
}

// ---------------------------------------------------------------------------
// Subscribed calendars and the feed (Settings → Calendar)
// ---------------------------------------------------------------------------

export function useCalendarSubscriptions() {
  const workspace = useWorkspace();
  return useQuery({
    queryKey: schedulerKeys.subscriptions(workspace.userId),
    queryFn: async () =>
      (must(
        await createClient()
          .from("calendar_subscriptions")
          .select(SUBSCRIPTION_COLUMNS)
          .eq("user_id", workspace.userId)
          .order("created_at")
          .limit(20),
      ) ?? []) as CalendarSubscription[],
  });
}

export type SubscriptionBusy = {
  id: string;
  name: string;
  color: string;
  busy: Array<{ start: string; end: string; allDay?: true }>;
};

/** The busy times of the calendars shown in the Gradus calendar (grey, read only). */
export function useSubscriptionBusy(enabled: boolean) {
  const workspace = useWorkspace();
  return useQuery({
    queryKey: schedulerKeys.busy(workspace.userId),
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () =>
      (must(
        await createClient()
          .from("calendar_subscriptions")
          .select("id, name, color, busy")
          .eq("user_id", workspace.userId)
          .eq("show_in_calendar", true)
          .limit(10),
      ) ?? []) as unknown as SubscriptionBusy[],
  });
}

function invalidateSubscriptions(queryClient: QueryClient, userId: string) {
  return queryClient.invalidateQueries({ queryKey: schedulerKeys.subscriptions(userId) });
}

export function useAddSubscription() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; color: string; url: string }) =>
      unwrap(addCalendarSubscription(input)),
    onSettled: () => invalidateSubscriptions(queryClient, workspace.userId),
  });
}

export function useUpdateSubscription() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      patch: { name?: string; color?: string; show_in_calendar?: boolean };
    }) => {
      const { error } = await createClient()
        .from("calendar_subscriptions")
        .update(input.patch)
        .eq("id", input.id)
        .eq("user_id", workspace.userId);
      if (error) throw error;
    },
    onSettled: () => invalidateSubscriptions(queryClient, workspace.userId),
  });
}

export function useDeleteSubscription() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await createClient()
        .from("calendar_subscriptions")
        .delete()
        .eq("id", id)
        .eq("user_id", workspace.userId);
      if (error) throw error;
      track("calendar_subscription_removed", {});
    },
    onSettled: () => invalidateSubscriptions(queryClient, workspace.userId),
  });
}

export function useRefreshSubscription() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(refreshCalendarSubscription(id)),
    onSettled: () => invalidateSubscriptions(queryClient, workspace.userId),
  });
}

export function useFeedState() {
  const workspace = useWorkspace();
  return useQuery({
    queryKey: schedulerKeys.feed(workspace.userId),
    queryFn: () => unwrap(calendarFeedState()),
  });
}

export function useCreateFeed() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(createCalendarFeed()),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: schedulerKeys.feed(workspace.userId) }),
  });
}

export function useRevokeFeed() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(revokeCalendarFeed()),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: schedulerKeys.feed(workspace.userId) }),
  });
}
