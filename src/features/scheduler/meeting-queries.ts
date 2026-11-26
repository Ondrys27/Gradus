"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { useWorkspace } from "@/features/account/workspace-queries";
import { track } from "@/lib/analytics/client";
import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/types/database";
import {
  appSlotsAction,
  attachDealToBookingAction,
  bookForContactAction,
  meetingSetupAction,
} from "./app-booking-actions";
import type { BookingDialogSource } from "./analytics";
import { toStored, type ResolvedSources } from "./calendar-sources";
import { parseMeetingSettings, type MeetingSettings } from "./meeting-plan";
import type { AppBookingProblem } from "./server/app-booking";
import { schedulerKeys } from "./queries";

/**
 * The meeting dialog (30.4) and the settings around it, in the browser: the
 * dialog's steps go through the server actions (app-booking-actions.ts), the
 * owner's Cold Calling settings and the scheduler's calendars through the
 * user's own client and RLS.
 */

export class MeetingError extends Error {
  constructor(
    readonly problem: AppBookingProblem,
    readonly details?: string,
  ) {
    super(problem);
  }
}

export const meetingKeys = {
  setup: (userId: string, space: string, contact: string) =>
    ["scheduler", userId, "meeting-setup", space, contact] as const,
  slots: (userId: string, space: string, host: string, type: string, zone: string) =>
    ["scheduler", userId, "meeting-slots", space, host, type, zone] as const,
  settings: (userId: string, space: string) =>
    ["scheduler", userId, "meeting-settings", space] as const,
};

export function useMeetingSetup(contactId: string | null) {
  const { user } = useSession();
  const workspaceId = useWorkspace().id;
  return useQuery({
    queryKey: meetingKeys.setup(user.id, workspaceId, contactId ?? "none"),
    enabled: Boolean(contactId),
    staleTime: 0,
    queryFn: async () => {
      const result = await meetingSetupAction(contactId!);
      if (!result.ok) throw new MeetingError(result.problem);
      return result.data;
    },
  });
}

export function useAppSlots(hostId: string | null, typeId: string | null, timeZone: string) {
  const { user } = useSession();
  const workspaceId = useWorkspace().id;
  return useQuery({
    queryKey: meetingKeys.slots(user.id, workspaceId, hostId ?? "none", typeId ?? "none", timeZone),
    enabled: Boolean(hostId && typeId),
    staleTime: 30_000,
    queryFn: async () => {
      const result = await appSlotsAction({ hostId: hostId!, typeId: typeId!, timeZone });
      if (!result.ok) throw new MeetingError(result.problem);
      return result.data;
    },
  });
}

export function useBookForContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Parameters<typeof bookForContactAction>[0]) => {
      const result = await bookForContactAction(input);
      if (!result.ok) throw new MeetingError(result.problem, result.details);
      return result.data;
    },
    // A booking touches the calendar, the contact, Cold Calling, the scheduler and Grady.
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

/** A deal made right after the booking takes its meeting. */
export function useAttachDealToBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { bookingId: string; dealId: string }) => {
      const result = await attachDealToBookingAction(input);
      if (!result.ok) throw new MeetingError(result.problem);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["calendar"] }),
  });
}

export function trackDialogOpened(from: BookingDialogSource, setup: boolean) {
  track("booking_dialog_opened", { from, setup });
}

// ---------------------------------------------------------------------------
// The owner's Cold Calling settings
// ---------------------------------------------------------------------------

export function useMeetingSettings() {
  const { user } = useSession();
  const workspaceId = useWorkspace().id;
  return useQuery({
    queryKey: meetingKeys.settings(user.id, workspaceId),
    queryFn: async (): Promise<MeetingSettings> => {
      const { data, error } = await createClient()
        .from("cold_calling_meeting_settings")
        .select("host_mode, host_user_id, event_type_id, type_locked, ignore_notice")
        .eq("space_id", workspaceId)
        .maybeSingle();
      if (error) throw error;
      return parseMeetingSettings(data);
    },
  });
}

export function useSaveMeetingSettings() {
  const { user } = useSession();
  const workspaceId = useWorkspace().id;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (next: MeetingSettings) => {
      const fields = {
        host_mode: next.hostMode,
        host_user_id: next.hostMode === "person" ? next.hostUserId : null,
        event_type_id: next.eventTypeId,
        type_locked: next.typeLocked,
        ignore_notice: next.ignoreNotice,
      };
      // No upsert: PostgREST's ON CONFLICT DO UPDATE sets every sent column,
      // space_id too, and the client has no UPDATE grant on space_id (403).
      const supabase = createClient();
      const update = () =>
        supabase
          .from("cold_calling_meeting_settings")
          .update(fields)
          .eq("space_id", workspaceId)
          .select("space_id");
      const updated = await update();
      if (updated.error) throw updated.error;
      if (updated.data.length === 0) {
        const inserted = await supabase
          .from("cold_calling_meeting_settings")
          .insert({ space_id: workspaceId, ...fields });
        if (inserted.error?.code === "23505") {
          const again = await update();
          if (again.error) throw again.error;
        } else if (inserted.error) {
          throw inserted.error;
        }
      }
      track("cold_calling_meeting_settings_saved", {
        host_mode: next.hostMode,
        type_set: Boolean(next.eventTypeId),
        type_locked: next.typeLocked,
        ignore_notice: next.ignoreNotice,
      });
      return next;
    },
    onSuccess: (next) => queryClient.setQueryData(meetingKeys.settings(user.id, workspaceId), next),
  });
}

// ---------------------------------------------------------------------------
// The scheduler's own calendars (profile and one type)
// ---------------------------------------------------------------------------

export function useSaveCalendarSources() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input:
        | { scope: "profile"; profileId: string; sources: ResolvedSources }
        | { scope: "type"; typeId: string; sources: ResolvedSources | null },
    ) => {
      const supabase = createClient();
      const value = input.sources ? (toStored(input.sources) as unknown as Json) : null;
      const { error } =
        input.scope === "profile"
          ? await supabase
              .from("scheduler_profiles")
              .update({ calendar_sources: value })
              .eq("id", input.profileId)
          : await supabase
              .from("event_types")
              .update({ calendar_sources: value })
              .eq("id", input.typeId);
      if (error) throw error;
      track("scheduler_calendar_sources_saved", {
        scope: input.scope,
        gradus: input.sources?.gradus ?? true,
        calendars: Math.min(input.sources?.calendars.length ?? 0, 200),
        subscriptions: Math.min(input.sources?.subscriptions.length ?? 0, 20),
        write: Boolean(input.sources?.write),
        ...(input.scope === "type" ? { inherit: input.sources === null } : {}),
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: schedulerKeys.all(user.id) }),
  });
}
