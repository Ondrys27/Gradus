"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { track } from "@/lib/analytics/client";
import { createClient } from "@/lib/supabase/client";
import { workerKeys } from "../queries";
import type { DashboardWorker } from "./types";

export const dashboardKeys = {
  // Under "workers", so every change of a worker refreshes the dashboard too.
  all: (userId: string, workerId: string) =>
    [...workerKeys.all(userId), "dashboard", workerId] as const,
  worker: (userId: string, workerId: string) =>
    [...dashboardKeys.all(userId, workerId), "person"] as const,
};

/** One person of Company with what the viewer may do with them; null when not visible. */
export function useCompanyWorker(workerId: string | null) {
  const { user } = useSession();
  return useQuery({
    queryKey: dashboardKeys.worker(user.id, workerId ?? ""),
    enabled: Boolean(workerId),
    queryFn: async (): Promise<DashboardWorker | null> => {
      const { data, error } = await createClient().rpc("company_worker", {
        _worker_id: workerId!,
      });
      if (error) throw error;
      const row = data[0];
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        firstName: row.first_name ?? null,
        lastName: row.last_name ?? null,
        email: row.email ?? null,
        phone: row.phone ?? null,
        jobTitle: row.job_title ?? null,
        description: row.description ?? null,
        avatarUrl: row.avatar_url ?? null,
        status: row.status,
        managerId: row.manager_id ?? null,
        userId: row.user_id ?? null,
        createdAt: row.created_at,
        canEdit: row.can_edit === true,
        isSelf: row.is_self === true,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Changing a person
// ---------------------------------------------------------------------------

/** Fields of a person the dashboard edits in place. */
export type WorkerField =
  "first_name" | "last_name" | "email" | "phone" | "job_title" | "description" | "avatar_url";

/** Why a change did not happen, as the screen says it (`workers.dashboard.errors.*`). */
export type DashboardError =
  | "accessDenied"
  | "readOnly"
  | "phoneInvalid"
  | "emailInvalid"
  | "tooLong"
  | "nameRequired"
  | "photoInvalid"
  | "assigneeOutside"
  | "saveFailed";

export function dashboardErrorOf(cause: unknown): DashboardError {
  const error = cause as { message?: string; code?: string } | null;
  const message = error?.message ?? "";
  if (message.includes("company_access_denied") || error?.code === "42501") return "accessDenied";
  if (message.includes("read_only")) return "readOnly";
  if (message.includes("worker_phone_invalid")) return "phoneInvalid";
  if (message.includes("worker_email_invalid")) return "emailInvalid";
  if (message.includes("worker_avatar_invalid")) return "photoInvalid";
  if (message.includes("worker_assignee_outside")) return "assigneeOutside";
  if (message.includes("workers_name_length")) return "nameRequired";
  if (error?.code === "23514") return "tooLong";
  return "saveFailed";
}

function useInvalidateWorker() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: workerKeys.all(user.id) });
}

/** Saves one change of a person's details (company_update_worker); the database checks who may. */
export function useUpdateCompanyWorker(worker: Pick<DashboardWorker, "id" | "isSelf">) {
  const { user, worker: me } = useSession();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateWorker();
  const key = dashboardKeys.worker(user.id, worker.id);
  return useMutation({
    mutationFn: async (patch: Partial<Record<WorkerField, string | null>>) => {
      const { error } = await createClient().rpc("company_update_worker", {
        _worker_id: worker.id,
        _patch: patch,
      });
      if (error) throw error;
      const by = worker.isSelf ? "self" : me ? "other" : "owner";
      for (const field of Object.keys(patch) as WorkerField[]) {
        track("worker_profile_updated", {
          field: field === "avatar_url" ? "photo" : field,
          by,
        });
      }
    },
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<DashboardWorker | null>(key);
      if (previous) {
        queryClient.setQueryData<DashboardWorker>(key, { ...previous, ...toLocal(patch) });
      }
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => invalidate(),
  });
}

function toLocal(patch: Partial<Record<WorkerField, string | null>>): Partial<DashboardWorker> {
  const local: Partial<DashboardWorker> = {};
  if ("first_name" in patch) local.firstName = patch.first_name ?? null;
  if ("last_name" in patch) local.lastName = patch.last_name ?? null;
  if ("email" in patch) local.email = patch.email ?? null;
  if ("phone" in patch) local.phone = patch.phone ?? null;
  if ("job_title" in patch) local.jobTitle = patch.job_title ?? null;
  if ("description" in patch) local.description = patch.description ?? null;
  if ("avatar_url" in patch) local.avatarUrl = patch.avatar_url ?? null;
  return local;
}

/** Adds the person to a group or takes them out. */
export function useSetGroupMember(worker: Pick<DashboardWorker, "id" | "isSelf">) {
  const { worker: me } = useSession();
  const invalidate = useInvalidateWorker();
  return useMutation({
    mutationFn: async ({ groupId, member }: { groupId: string; member: boolean }) => {
      const { error } = await createClient().rpc("company_set_group_member", {
        _worker_id: worker.id,
        _group_id: groupId,
        _member: member,
      });
      if (error) throw error;
      track("worker_profile_updated", { field: "groups", by: me ? "other" : "owner" });
    },
    onSettled: () => invalidate(),
  });
}

export type WorkerImpact = { openDeals: number; openCrmTasks: number; openWorkerTasks: number };

/** What the person has in their care, for the confirmation of their removal (owner only). */
export function useWorkerImpact(workerId: string, enabled: boolean) {
  const { user } = useSession();
  return useQuery({
    queryKey: [...dashboardKeys.all(user.id, workerId), "impact"],
    enabled,
    queryFn: async (): Promise<WorkerImpact> => {
      const { data, error } = await createClient().rpc("company_worker_impact", {
        _worker_id: workerId,
      });
      if (error) throw error;
      const row = data[0];
      return {
        openDeals: row?.open_deals ?? 0,
        openCrmTasks: row?.open_crm_tasks ?? 0,
        openWorkerTasks: row?.open_worker_tasks ?? 0,
      };
    },
  });
}

/**
 * Removes the person from the company: their access ends at once, the data
 * stays. Open deals and tasks go to `assignee` (an account) when given.
 */
export function useRemoveWorker(workerId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateWorker();
  return useMutation({
    mutationFn: async ({
      assignee,
      to,
    }: {
      assignee: string | null;
      to: "owner" | "worker" | "nobody";
    }) => {
      const { data, error } = await createClient().rpc("company_remove_worker", {
        _worker_id: workerId,
        ...(assignee ? { _assignee: assignee } : {}),
      });
      if (error) throw error;
      const row = data[0];
      track("worker_removed", {
        deals: Math.min(row?.deals ?? 0, 10_000),
        tasks: Math.min((row?.crm_tasks ?? 0) + (row?.worker_tasks ?? 0), 10_000),
        to,
      });
    },
    onSettled: () => {
      void invalidate();
      // Deals and tasks changed hands.
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== "account",
      });
    },
  });
}
