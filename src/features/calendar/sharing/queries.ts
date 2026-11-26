"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { inboxKeys } from "@/features/account/inbox";
import { useWorkspaceId } from "@/features/account/workspace-queries";
import { track } from "@/lib/analytics/client";
import { createClient } from "@/lib/supabase/client";
import type { IsoDate } from "@/lib/format";
import { dayRangeToInstants } from "../calendar-logic";
import { requestCalendarPush } from "../sync/queries";
import {
  defaultPersonTone,
  isPersonTone,
  isShareLevel,
  toVisiblePeople,
  type PersonTone,
  type ShareLevel,
  type ShareTarget,
  type VisiblePerson,
} from "./levels";

/**
 * Calendar sharing in the active space (30.3), read and written with the
 * account's own client: everything goes through the database's functions,
 * which check membership and the shares themselves.
 */

export const sharingKeys = {
  all: (userId: string) => ["calendar", userId, "sharing"] as const,
  people: (userId: string, space: string) =>
    ["calendar", userId, "sharing", "people", space] as const,
  events: (userId: string, space: string, from: string, to: string) =>
    ["calendar", userId, "sharing", "events", space, from, to] as const,
  mine: (userId: string, space: string) => ["calendar", userId, "sharing", "mine", space] as const,
  sources: (userId: string) => ["calendar", userId, "sharing", "sources"] as const,
  requests: (userId: string, space: string) =>
    ["calendar", userId, "sharing", "requests", space] as const,
  prefs: (userId: string) => ["calendar", userId, "sharing", "prefs"] as const,
  busy: (userId: string, space: string, people: string, from: string, to: string) =>
    ["calendar", userId, "sharing", "busy", space, people, from, to] as const,
  attendees: (userId: string, event: string) =>
    ["calendar", userId, "sharing", "attendees", event] as const,
};

/** A database error's message is the code the functions raise (calendar_request_too_soon …). */
export class SharingError extends Error {
  constructor(
    readonly code: string,
    readonly detail: string | null = null,
  ) {
    super(code);
  }
}

const KNOWN_CODES = [
  "calendar_request_too_soon",
  "calendar_request_already",
  "calendar_request_limit",
  "calendar_request_target",
  "calendar_share_target",
  "calendar_share_sources",
  "calendar_write_denied",
  "calendar_event_invalid",
  "calendar_meeting_denied",
  "calendar_meeting_invalid",
  "read_only",
  "not_found",
] as const;
export type SharingErrorCode = (typeof KNOWN_CODES)[number] | "unknown";

function fail(error: { message?: string; details?: string | null }): never {
  const message = error.message ?? "";
  const code = KNOWN_CODES.find((known) => message.includes(known)) ?? "unknown";
  throw new SharingError(code, error.details ?? null);
}

export function sharingErrorCode(error: unknown): SharingErrorCode {
  return error instanceof SharingError ? (error.code as SharingErrorCode) : "unknown";
}

function useSpace() {
  const { user } = useSession();
  const space = useWorkspaceId();
  return { userId: user.id, space };
}

/** The people whose calendars the account sees here, with their levels. */
export function useCalendarPeople(enabled = true) {
  const { userId, space } = useSpace();
  return useQuery({
    queryKey: sharingKeys.people(userId, space),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<VisiblePerson[]> => {
      const { data, error } = await createClient().rpc("calendar_visible_people", {
        _space: space,
      });
      if (error) fail(error);
      return toVisiblePeople(data ?? []);
    },
  });
}

export type SharedEvent = {
  id: string;
  personId: string;
  level: ShareLevel | "invite";
  busyOnly: boolean;
  private: boolean;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  title: string | null;
  description: string | null;
  location: string | null;
  kind: string | null;
  source: string | null;
  createdBy: string | null;
  createdByName: string | null;
  canEdit: boolean;
  inviteStatus: "invited" | "accepted" | "declined" | null;
};

/** Others' events in the shown days, each at the level the account has (calendar_shared_events). */
export function useSharedEvents(
  firstDay: IsoDate,
  lastDay: IsoDate,
  timeZone: string,
  enabled: boolean,
) {
  const { userId, space } = useSpace();
  const { from, to } = dayRangeToInstants(firstDay, lastDay, timeZone);
  return useQuery({
    queryKey: sharingKeys.events(userId, space, from, to),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<SharedEvent[]> => {
      const { data, error } = await createClient().rpc("calendar_shared_events", {
        _space: space,
        _from: from,
        _to: to,
      });
      if (error) fail(error);
      return (data ?? []).flatMap((row) => {
        const level =
          row.level === "invite" ? "invite" : isShareLevel(row.level) ? row.level : null;
        if (!level) return [];
        return [
          {
            id: row.id,
            personId: row.person_id,
            level,
            busyOnly: Boolean(row.busy_only),
            private: Boolean(row.private),
            startsAt: row.starts_at,
            endsAt: row.ends_at ?? null,
            allDay: Boolean(row.all_day),
            title: row.title ?? null,
            description: row.description ?? null,
            location: row.location ?? null,
            kind: row.kind ?? null,
            source: row.source ?? null,
            createdBy: row.created_by ?? null,
            createdByName: row.created_by_name?.trim() || null,
            canEdit: Boolean(row.can_edit),
            inviteStatus:
              row.invite_status === "invited" ||
              row.invite_status === "accepted" ||
              row.invite_status === "declined"
                ? row.invite_status
                : null,
          },
        ];
      });
    },
  });
}

export type MySource = {
  key: string;
  name: string | null;
  writes: boolean;
  privateDefault: boolean;
};

/** The account's own sources: Gradus and the Google / Apple calendars it reads. */
export function useMySources(enabled = true) {
  const { userId } = useSpace();
  return useQuery({
    queryKey: sharingKeys.sources(userId),
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<MySource[]> => {
      const { data, error } = await createClient().rpc("calendar_my_sources");
      if (error) fail(error);
      return (data ?? []).map((row) => ({
        key: row.key,
        name: row.name ?? null,
        writes: Boolean(row.writes),
        privateDefault: Boolean(row.private_default),
      }));
    },
  });
}

export type MyShare = {
  entry: "auto" | "share";
  shareId: string | null;
  targetKind: ShareTarget;
  targetUserId: string | null;
  groupId: string | null;
  name: string | null;
  avatarUrl: string | null;
  memberCount: number | null;
  level: ShareLevel;
  calendars: string[];
};

/** Who sees the account's calendar here (and the owner's default, for a worker). */
export function useMyShares(enabled = true) {
  const { userId, space } = useSpace();
  return useQuery({
    queryKey: sharingKeys.mine(userId, space),
    enabled,
    queryFn: async (): Promise<MyShare[]> => {
      const { data, error } = await createClient().rpc("calendar_my_shares", { _space: space });
      if (error) fail(error);
      return (data ?? []).flatMap((row) =>
        isShareLevel(row.level) &&
        (row.target_kind === "member" || row.target_kind === "group" || row.target_kind === "space")
          ? [
              {
                entry: row.entry === "auto" ? ("auto" as const) : ("share" as const),
                shareId: row.share_id ?? null,
                targetKind: row.target_kind,
                targetUserId: row.target_user_id ?? null,
                groupId: row.group_id ?? null,
                name: row.name?.trim() || null,
                avatarUrl: row.avatar_url ?? null,
                memberCount: row.member_count ?? null,
                level: row.level,
                calendars: row.calendars ?? [],
              },
            ]
          : [],
      );
    },
  });
}

export type ShareRequest = {
  id: string;
  spaceId: string;
  incoming: boolean;
  personId: string;
  name: string;
  avatarUrl: string | null;
  level: ShareLevel;
  message: string | null;
  status: "pending" | "approved" | "declined";
  approvedLevel: ShareLevel | null;
  createdAt: string;
  respondedAt: string | null;
  retryAt: string | null;
};

export function useShareRequests(enabled = true) {
  const { userId, space } = useSpace();
  return useQuery({
    queryKey: sharingKeys.requests(userId, space),
    enabled,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ShareRequest[]> => {
      const { data, error } = await createClient().rpc("calendar_share_requests_list", {
        _space: space,
      });
      if (error) fail(error);
      return (data ?? []).flatMap((row) =>
        isShareLevel(row.level) &&
        (row.status === "pending" || row.status === "approved" || row.status === "declined")
          ? [
              {
                id: row.id,
                spaceId: row.space_id,
                incoming: Boolean(row.incoming),
                personId: row.person_id,
                name: row.name?.trim() || "",
                avatarUrl: row.avatar_url ?? null,
                level: row.level,
                message: row.message ?? null,
                status: row.status,
                approvedLevel: isShareLevel(row.approved_level) ? row.approved_level : null,
                createdAt: row.created_at,
                respondedAt: row.responded_at ?? null,
                retryAt: row.retry_at ?? null,
              },
            ]
          : [],
      );
    },
  });
}

function useInvalidateSharing() {
  const { userId } = useSpace();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["calendar", userId] });
    void queryClient.invalidateQueries({ queryKey: inboxKeys.all(userId) });
  };
}

export function useSaveShare() {
  const { space } = useSpace();
  const invalidate = useInvalidateSharing();
  return useMutation({
    mutationFn: async (input: {
      targetKind: ShareTarget;
      target: string | null;
      level: ShareLevel;
      calendars: string[];
      created: boolean;
    }) => {
      const { error } = await createClient().rpc("calendar_share_set", {
        _space: space,
        _target_kind: input.targetKind,
        _target: input.target as string,
        _level: input.level,
        _calendars: input.calendars,
      });
      if (error) fail(error);
      track("calendar_share_saved", {
        target: input.targetKind,
        level: input.level,
        calendars: input.calendars.length,
        created: input.created,
      });
    },
    onSettled: invalidate,
  });
}

export function useRemoveShare() {
  const invalidate = useInvalidateSharing();
  return useMutation({
    mutationFn: async (shareId: string) => {
      const { error } = await createClient().rpc("calendar_share_remove", { _share: shareId });
      if (error) fail(error);
      track("calendar_share_removed", {});
    },
    onSettled: invalidate,
  });
}

export type RequestOrigin = "company" | "messages" | "calendar" | "settings";

export function useRequestShare() {
  const { space } = useSpace();
  const invalidate = useInvalidateSharing();
  return useMutation({
    mutationFn: async (input: {
      to: string;
      level: ShareLevel;
      message: string;
      from: RequestOrigin;
    }) => {
      const message = input.message.trim();
      const { error } = await createClient().rpc("calendar_share_request_create", {
        _space: space,
        _to: input.to,
        _level: input.level,
        _message: message || undefined,
      });
      if (error) fail(error);
      track("calendar_share_requested", {
        level: input.level,
        from: input.from,
        with_message: message.length > 0,
      });
    },
    onSettled: invalidate,
  });
}

export function useRespondShareRequest() {
  const invalidate = useInvalidateSharing();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      approve: boolean;
      level: ShareLevel | null;
      asked: ShareLevel;
    }) => {
      const { error } = await createClient().rpc("calendar_share_request_respond", {
        _request: input.id,
        _approve: input.approve,
        _level: input.level ?? undefined,
      });
      if (error) fail(error);
      track("calendar_share_request_answered", {
        approved: input.approve,
        level: input.approve ? (input.level ?? input.asked) : undefined,
        changed: input.approve && input.level !== null && input.level !== input.asked,
      });
    },
    onSettled: invalidate,
  });
}

export type PersonPref = { tone: PersonTone; hidden: boolean };

/** The colour and checkbox the account keeps per person (any space). */
export function usePersonPrefs() {
  const { userId } = useSpace();
  return useQuery({
    queryKey: sharingKeys.prefs(userId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Map<string, PersonPref>> => {
      const { data, error } = await createClient()
        .from("calendar_view_people")
        .select("person_id, tone, hidden")
        .eq("user_id", userId)
        .limit(500);
      if (error) fail(error);
      return new Map(
        (data ?? []).map((row) => [
          row.person_id,
          {
            tone: isPersonTone(row.tone) ? row.tone : defaultPersonTone(row.person_id),
            hidden: row.hidden,
          },
        ]),
      );
    },
  });
}

/** A person's colour or checkbox; the screen changes at once and goes back if the save fails. */
export function useSetPersonPref() {
  const { userId } = useSpace();
  const queryClient = useQueryClient();
  const key = sharingKeys.prefs(userId);
  return useMutation({
    mutationFn: async (input: { personId: string } & PersonPref) => {
      const { error } = await createClient()
        .from("calendar_view_people")
        .upsert(
          { user_id: userId, person_id: input.personId, tone: input.tone, hidden: input.hidden },
          { onConflict: "user_id,person_id" },
        );
      if (error) fail(error);
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Map<string, PersonPref>>(key);
      const next = new Map(previous ?? []);
      next.set(input.personId, { tone: input.tone, hidden: input.hidden });
      queryClient.setQueryData(key, next);
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
  });
}

export type SharedEventInput = {
  owner: string;
  eventId: string | null;
  title: string;
  kind: "meeting" | "task" | "deadline";
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  description: string;
  private: boolean;
};

/** Writes into someone's calendar through a write share. */
export function useSaveSharedEvent() {
  const { space } = useSpace();
  const invalidate = useInvalidateSharing();
  return useMutation({
    mutationFn: async (input: SharedEventInput) => {
      const { data, error } = await createClient().rpc("calendar_shared_event_save", {
        _space: space,
        _owner: input.owner,
        _event: input.eventId as string,
        _title: input.title,
        _kind: input.kind,
        _starts: input.startsAt,
        _ends: input.endsAt as string,
        _all_day: input.allDay,
        _description: input.description || undefined,
        _private: input.private,
      });
      if (error) fail(error);
      track("calendar_shared_event_saved", { created: input.eventId === null });
      return data;
    },
    onSuccess: requestCalendarPush,
    onSettled: invalidate,
  });
}

export function useDeleteSharedEvent() {
  const invalidate = useInvalidateSharing();
  return useMutation({
    mutationFn: async (eventId: string) => {
      const { error } = await createClient().rpc("calendar_shared_event_delete", {
        _event: eventId,
      });
      if (error) fail(error);
      track("calendar_event_deleted", {});
    },
    onSuccess: requestCalendarPush,
    onSettled: invalidate,
  });
}

/** Busy times of the chosen people (and the account) for "Find a common time". */
export function usePeopleBusy(people: string[], from: string, to: string, enabled: boolean) {
  const { userId, space } = useSpace();
  const sorted = [...people].sort();
  return useQuery({
    queryKey: sharingKeys.busy(userId, space, sorted.join(","), from, to),
    enabled: enabled && sorted.length > 0,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("calendar_people_busy", {
        _space: space,
        _people: [...new Set([userId, ...sorted])],
        _from: from,
        _to: to,
      });
      if (error) fail(error);
      return data ?? [];
    },
  });
}

export function useCreateMeeting() {
  const { space } = useSpace();
  const invalidate = useInvalidateSharing();
  return useMutation({
    mutationFn: async (input: {
      title: string;
      startsAt: string;
      endsAt: string;
      attendees: string[];
      description: string;
    }) => {
      const { data, error } = await createClient().rpc("calendar_meeting_create", {
        _space: space,
        _title: input.title,
        _starts: input.startsAt,
        _ends: input.endsAt,
        _attendees: input.attendees,
        _description: input.description || undefined,
      });
      if (error) fail(error);
      track("calendar_meeting_invited", { attendees: input.attendees.length });
      return data;
    },
    onSuccess: requestCalendarPush,
    onSettled: invalidate,
  });
}

export function useRespondMeetingInvite() {
  const invalidate = useInvalidateSharing();
  return useMutation({
    mutationFn: async (input: { eventId: string; accept: boolean }) => {
      const { error } = await createClient().rpc("calendar_invite_respond", {
        _event: input.eventId,
        _accept: input.accept,
      });
      if (error) fail(error);
      track("calendar_invite_answered", { accepted: input.accept });
    },
    onSettled: invalidate,
  });
}

export type EventPerson = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  status: string;
};

/** The people invited to a meeting with their answers. */
export function useEventPeople(eventId: string | null) {
  const { userId } = useSpace();
  return useQuery({
    queryKey: sharingKeys.attendees(userId, eventId ?? ""),
    enabled: Boolean(eventId),
    queryFn: async (): Promise<EventPerson[]> => {
      const { data, error } = await createClient().rpc("calendar_event_people", {
        _event: eventId!,
      });
      if (error) fail(error);
      return (data ?? []).map((row) => ({
        userId: row.user_id,
        name: row.name?.trim() || "",
        avatarUrl: row.avatar_url ?? null,
        status: row.status,
      }));
    },
  });
}

/** "Everything from this calendar is private." */
export function useSetPrivateDefault() {
  const invalidate = useInvalidateSharing();
  return useMutation({
    mutationFn: async (input: { calendarId: string; private: boolean }) => {
      const { error } = await createClient().rpc("calendar_set_private_default", {
        _calendar: input.calendarId,
        _private: input.private,
      });
      if (error) fail(error);
    },
    onSettled: invalidate,
  });
}

export type CalendarGroup = { id: string; name: string; people: string[] };

/** The company's groups with their active people, to pick a whole group at once. */
export function useCalendarGroups(enabled = true) {
  const { userId, space } = useSpace();
  return useQuery({
    queryKey: [...sharingKeys.all(userId), "groups", space] as const,
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<CalendarGroup[]> => {
      const { data, error } = await createClient().rpc("calendar_groups", { _space: space });
      if (error) fail(error);
      return (data ?? []).map((row) => ({ id: row.id, name: row.name, people: row.people ?? [] }));
    },
  });
}
