"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RuleDefinition } from "@/features/workers/rewards/definition";
import { parseRule } from "@/features/workers/rewards/rules";
import {
  grantsFromRows,
  type GrantRow,
  type PermissionGrants,
} from "@/features/workers/permissions-catalog";
import {
  leaveCompany,
  respondToInvite,
  type InviteErrorCode,
} from "@/features/workers/server/invites";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "./queries";

/**
 * What waits for the account across companies (step 22.5): invites into other
 * companies (my_worker_invites) and what the owner hears about their people
 * (account_notifications). Read with the account's own client, in any space;
 * the bell in the top bar and the invites page share it.
 */

/** Notifications kept on screen; older ones only age out. */
const NOTIFICATIONS_LIMIT = 20;
/** The bell checks again this often while the app is open (and on focus). */
const INBOX_REFRESH_MS = 60_000;

export type PendingInvite = {
  id: string;
  spaceId: string;
  companyName: string | null;
  logoUrl: string | null;
  ownerName: string | null;
  jobTitle: string | null;
  grants: PermissionGrants;
  /** The rules of the plan the owner set for this person, in its currency. */
  /** The person's rules with the names of the tables and stages they point at (the invitee has no access to them yet). */
  rewards: Array<{ definition: RuleDefinition; currency: string; names: Record<string, string> }>;
  expiresAt: string;
  createdAt: string;
};

export type AccountNotification = {
  id: string;
  kind:
    | "invite_accepted"
    | "invite_declined"
    | "worker_left"
    | "invite_requested"
    /** A note or a folder shared with the account (28.3). */
    | "note_shared"
    /** A departing worker's shared notes stay with the company, now the owner's. */
    | "notes_transferred"
    /** Calendar sharing (30.3): a share, a request and its answer, an invite to a meeting. */
    | "calendar_shared"
    | "calendar_share_requested"
    | "calendar_share_approved"
    | "calendar_share_declined"
    | "calendar_invite";
  workerId: string | null;
  workerName: string | null;
  createdAt: string;
  read: boolean;
  /** Note notifications: the space, the note or folder, who did it and its title (while reachable). */
  spaceId?: string | null;
  noteId?: string | null;
  folderId?: string | null;
  actorName?: string | null;
  title?: string | null;
  itemCount?: number | null;
  /** Calendar notifications: the request, the meeting, the level (30.3). */
  calendarRequestId?: string | null;
  eventId?: string | null;
  eventStartsAt?: string | null;
  shareLevel?: string | null;
  requestStatus?: string | null;
};

export type Inbox = { invites: PendingInvite[]; notifications: AccountNotification[] };

export const inboxKeys = {
  all: (userId: string) => ["account", userId, "inbox"] as const,
};

export class InboxActionError extends Error {
  constructor(readonly code: InviteErrorCode) {
    super(code);
  }
}

const KINDS = new Set([
  "invite_accepted",
  "invite_declined",
  "worker_left",
  "invite_requested",
  "note_shared",
  "notes_transferred",
  "calendar_shared",
  "calendar_share_requested",
  "calendar_share_approved",
  "calendar_share_declined",
  "calendar_invite",
]);

const CALENDAR_KINDS = new Set([
  "calendar_shared",
  "calendar_share_requested",
  "calendar_share_approved",
  "calendar_share_declined",
  "calendar_invite",
]);

export function isCalendarNotification(kind: AccountNotification["kind"]): boolean {
  return CALENDAR_KINDS.has(kind);
}

/** Where a calendar notification leads, through its company when that is not the open one. */
export function calendarNotificationHref(
  note: Pick<AccountNotification, "kind" | "spaceId" | "calendarRequestId" | "eventId">,
  activeSpace: string,
): string {
  const path =
    note.kind === "calendar_share_requested" && note.calendarRequestId
      ? `/app/kalendar?shareRequest=${encodeURIComponent(note.calendarRequestId)}`
      : note.kind === "calendar_invite" && note.eventId
        ? `/app/kalendar?event=${encodeURIComponent(note.eventId)}`
        : note.kind === "calendar_share_declined"
          ? "/app/nastaveni/kalendar?focus=settings-calendar-sharing"
          : "/app/kalendar";
  if (!note.spaceId || note.spaceId === activeSpace) return path;
  return `/app/prostor/${encodeURIComponent(note.spaceId)}?next=${encodeURIComponent(path)}`;
}

/** Where a notification of notes leads: the note or folder, through its company when that is not the open one. */
export function noteNotificationHref(
  note: Pick<AccountNotification, "spaceId" | "noteId" | "folderId">,
  activeSpace: string,
): string {
  const query = new URLSearchParams();
  if (note.folderId) query.set("folder", note.folderId);
  if (note.noteId) query.set("note", note.noteId);
  const search = query.toString();
  const path = search ? `/app/poznamky?${search}` : "/app/poznamky";
  if (!note.spaceId || note.spaceId === activeSpace) return path;
  return `/app/prostor/${encodeURIComponent(note.spaceId)}?next=${encodeURIComponent(path)}`;
}

function asRows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function useInbox() {
  const { user } = useSession();
  return useQuery({
    queryKey: inboxKeys.all(user.id),
    refetchInterval: INBOX_REFRESH_MS,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<Inbox> => {
      const supabase = createClient();
      const [invites, notes] = await Promise.all([
        supabase.rpc("my_worker_invites"),
        supabase
          .from("account_notifications")
          .select(
            "id, kind, worker_id, created_at, read_at, space_id, note_id, folder_id, item_count, calendar_request_id, event_id, share_level",
          )
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(NOTIFICATIONS_LIMIT),
      ]);
      if (invites.error) throw invites.error;
      if (notes.error) throw notes.error;
      // Who shared what: names and titles only while the account still reaches them.
      const noteIds = notes.data
        .filter((note) => note.kind === "note_shared" || note.kind === "notes_transferred")
        .map((note) => note.id);
      const labels = new Map<string, { actor: string | null; title: string | null }>();
      if (noteIds.length) {
        const { data, error } = await supabase.rpc("note_notification_labels", { _ids: noteIds });
        if (error) throw error;
        for (const row of data ?? []) {
          labels.set(row.id, { actor: row.actor_name || null, title: row.title ?? null });
        }
      }
      // Calendar sharing: who asked or shared, the meeting's title while the account is invited.
      const calendarIds = notes.data
        .filter((note) => CALENDAR_KINDS.has(note.kind))
        .map((note) => note.id);
      const calendarLabels = new Map<
        string,
        {
          actor: string | null;
          title: string | null;
          startsAt: string | null;
          status: string | null;
        }
      >();
      if (calendarIds.length) {
        const { data, error } = await supabase.rpc("calendar_notification_labels", {
          _ids: calendarIds,
        });
        if (error) throw error;
        for (const row of data ?? []) {
          calendarLabels.set(row.id, {
            actor: row.actor_name || null,
            title: row.event_title ?? null,
            startsAt: row.event_starts_at ?? null,
            status: row.request_status ?? null,
          });
        }
      }
      // The people the notifications are about are the account's own workers.
      const workerIds = [
        ...new Set(notes.data.flatMap((note) => (note.worker_id ? [note.worker_id] : []))),
      ];
      const names = new Map<string, string>();
      if (workerIds.length) {
        const { data, error } = await supabase
          .from("workers")
          .select("id, name")
          .eq("owner_id", user.id)
          .in("id", workerIds);
        if (error) throw error;
        for (const worker of data) names.set(worker.id, worker.name);
      }
      return {
        invites: (invites.data ?? []).map((row) => ({
          id: row.invite_id,
          spaceId: row.space_id,
          companyName: row.company_name?.trim() || null,
          logoUrl: row.logo_url || null,
          ownerName: row.owner_name?.trim() || null,
          jobTitle: row.job_title?.trim() || null,
          grants: grantsFromRows(asRows<GrantRow>(row.grants)),
          rewards: asRows<Record<string, unknown>>(row.rewards).flatMap((rule) => {
            // Only the shape of a rule; the plan's id and position are not in the invite.
            const parsed = parseRule({
              ...rule,
              id: "",
              plan_id: "",
              worker_id: "",
              cap_per_period: rule.cap ?? null,
              active: true,
              position: 0,
            });
            const names =
              rule.names && typeof rule.names === "object"
                ? (rule.names as Record<string, string>)
                : {};
            return parsed && typeof rule.currency === "string"
              ? [{ definition: parsed.definition, currency: rule.currency, names }]
              : [];
          }),
          expiresAt: row.expires_at,
          createdAt: row.created_at,
        })),
        notifications: notes.data.flatMap((note) =>
          KINDS.has(note.kind)
            ? [
                {
                  id: note.id,
                  kind: note.kind as AccountNotification["kind"],
                  workerId: note.worker_id,
                  workerName: note.worker_id ? (names.get(note.worker_id) ?? null) : null,
                  createdAt: note.created_at,
                  read: Boolean(note.read_at),
                  spaceId: note.space_id ?? null,
                  noteId: note.note_id ?? null,
                  folderId: note.folder_id ?? null,
                  actorName:
                    labels.get(note.id)?.actor ?? calendarLabels.get(note.id)?.actor ?? null,
                  title: labels.get(note.id)?.title ?? calendarLabels.get(note.id)?.title ?? null,
                  itemCount: note.item_count ?? null,
                  calendarRequestId: note.calendar_request_id ?? null,
                  eventId: note.event_id ?? null,
                  eventStartsAt: calendarLabels.get(note.id)?.startsAt ?? null,
                  shareLevel: note.share_level ?? null,
                  requestStatus: calendarLabels.get(note.id)?.status ?? null,
                },
              ]
            : [],
        ),
      };
    },
  });
}

/** "Novák s.r.o. · Václav Novák", or whichever of the two is known; null for neither. */
export function inviterName(
  invite: Pick<PendingInvite, "companyName" | "ownerName">,
): string | null {
  const parts = [invite.companyName, invite.ownerName].filter((part): part is string =>
    Boolean(part),
  );
  return [...new Set(parts)].join(" · ") || null;
}

/** How many things the bell counts: open invites and unread notifications. */
export function inboxCount(inbox: Inbox | undefined): number {
  if (!inbox) return 0;
  return inbox.invites.length + inbox.notifications.filter((note) => !note.read).length;
}

export function useMarkInboxRead() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await createClient().rpc("account_notifications_read");
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.setQueryData<Inbox>(inboxKeys.all(user.id), (inbox) =>
        inbox
          ? {
              ...inbox,
              notifications: inbox.notifications.map((note) => ({ ...note, read: true })),
            }
          : inbox,
      ),
  });
}

/** Accept or decline an invite; the company's space comes back. */
export function useRespondInvite() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { inviteId: string; accept: boolean }) => {
      const result = await respondToInvite(input);
      if (!result.ok) throw new InboxActionError(result.error);
      return result.data;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: inboxKeys.all(user.id) }),
  });
}

/** Leave a company; the owner hears it. */
export function useLeaveCompany() {
  return useMutation({
    mutationFn: async (spaceId: string) => {
      const result = await leaveCompany(spaceId);
      if (!result.ok) throw new InboxActionError(result.error);
    },
  });
}
