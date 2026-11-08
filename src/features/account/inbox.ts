"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { storedRule, type CompiledRule } from "@/features/workers/rewards/reward-tree";
import { grantsFromRows, type GrantRow, type PermissionGrants } from "@/features/workers/permissions-catalog";
import { leaveCompany, respondToInvite, type InviteErrorCode } from "@/features/workers/server/invites";
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
  rewards: CompiledRule[];
  expiresAt: string;
  createdAt: string;
};

export type AccountNotification = {
  id: string;
  kind: "invite_accepted" | "invite_declined" | "worker_left";
  workerId: string | null;
  workerName: string | null;
  createdAt: string;
  read: boolean;
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

const KINDS = new Set(["invite_accepted", "invite_declined", "worker_left"]);

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
          .select("id, kind, worker_id, created_at, read_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(NOTIFICATIONS_LIMIT),
      ]);
      if (invites.error) throw invites.error;
      if (notes.error) throw notes.error;
      // The people the notifications are about are the account's own workers.
      const workerIds = [...new Set(notes.data.flatMap((note) => (note.worker_id ? [note.worker_id] : [])))];
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
          rewards: asRows<{ name: string; worker_id: string | null; rules: unknown }>(row.rewards).flatMap(
            (rule) => {
              const parsed = storedRule(rule);
              return parsed ? [parsed] : [];
            },
          ),
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
                },
              ]
            : [],
        ),
      };
    },
  });
}

/** "Novák s.r.o. · Václav Novák", or whichever of the two is known; null for neither. */
export function inviterName(invite: Pick<PendingInvite, "companyName" | "ownerName">): string | null {
  const parts = [invite.companyName, invite.ownerName].filter((part): part is string => Boolean(part));
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
          ? { ...inbox, notifications: inbox.notifications.map((note) => ({ ...note, read: true })) }
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
