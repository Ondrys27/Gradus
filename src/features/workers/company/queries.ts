"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { track } from "@/lib/analytics/client";
import { clientOps } from "@/lib/ops-client";
import { createClient } from "@/lib/supabase/client";
import { moveWorker as moveWorkerOp, saveGroup, type GroupInput } from "../ops";
import { workerKeys } from "../queries";
import { depthOf, groupTone, moveWorker, type CompanyGroup, type CompanyPerson } from "./tree";

export const companyKeys = {
  // Under "workers", so every change of a worker refreshes the tree too.
  tree: (userId: string) => [...workerKeys.all(userId), "company", "tree"] as const,
  groups: (userId: string) => [...workerKeys.all(userId), "company", "groups"] as const,
};

/** Why a write did not happen, as the screen says it. */
export type CompanyError = "cycle" | "nameTaken" | "readOnly" | "saveFailed";

export function companyErrorOf(cause: unknown): CompanyError {
  const error = cause as { message?: string; code?: string } | null;
  const message = error?.message ?? "";
  if (message.includes("worker_manager_cycle")) return "cycle";
  if (message.includes("read_only")) return "readOnly";
  if (error?.code === "23505") return "nameTaken";
  return "saveFailed";
}

/**
 * The people the account may see in Company (company_tree()): every worker
 * for the owner, their own branch for a worker; with groups and what is open
 * in each person's care.
 */
export function useCompanyTree() {
  const { user } = useSession();
  return useQuery({
    queryKey: companyKeys.tree(user.id),
    queryFn: async (): Promise<CompanyPerson[]> => {
      const { data, error } = await createClient().rpc("company_tree");
      if (error) throw error;
      return data.map((row) => ({
        id: row.id,
        name: row.name,
        jobTitle: row.job_title ?? null,
        status: row.status,
        managerId: row.manager_id ?? null,
        userId: row.user_id ?? null,
        avatarUrl: row.avatar_url ?? null,
        openTasks: row.open_tasks ?? 0,
        openDeals: row.open_deals ?? 0,
        groupIds: row.group_ids ?? [],
      }));
    },
  });
}

/** The groups the account may see (company_groups()), in their order. */
export function useCompanyGroups() {
  const { user } = useSession();
  return useQuery({
    queryKey: companyKeys.groups(user.id),
    queryFn: async (): Promise<CompanyGroup[]> => {
      const { data, error } = await createClient().rpc("company_groups");
      if (error) throw error;
      return data.map((row) => ({
        id: row.id,
        name: row.name,
        color: groupTone(row.color),
        description: row.description ?? null,
        position: row.position,
        memberCount: row.member_count ?? 0,
      }));
    },
  });
}

export type MoveVia = "list" | "map" | "menu";

/**
 * Puts a worker under another manager (null = right under the owner); their
 * branch goes along. The tree shows it at once and goes back if the database
 * refuses (a cycle, a read-only space).
 */
export function useMoveWorker() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const key = companyKeys.tree(user.id);
  return useMutation({
    mutationFn: async (input: { workerId: string; managerId: string | null; via: MoveVia }) => {
      const previous = queryClient.getQueryData<CompanyPerson[]>(key);
      const after = previous ? moveWorker(previous, input.workerId, input.managerId) : [];
      await moveWorkerOp(clientOps(), {
        ownerId: user.id,
        workerId: input.workerId,
        managerId: input.managerId,
        via: input.via,
        depth: depthOf(after, input.workerId),
      });
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CompanyPerson[]>(key);
      if (previous) {
        queryClient.setQueryData<CompanyPerson[]>(
          key,
          moveWorker(previous, input.workerId, input.managerId),
        );
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

export type { GroupInput };

/** A new group or changes to one, with its members added and removed. */
export function useSaveGroup() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      group: GroupInput;
      /** Editing this group (its members before the edit), or a new one. */
      existing: { id: string; memberIds: string[] } | null;
      position: number;
    }) => {
      return saveGroup(clientOps(), {
        ownerId: user.id,
        group: input.group,
        existing: input.existing,
        position: input.position,
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: workerKeys.all(user.id) }),
  });
}

/** Deletes a group; its memberships end, the workers stay. */
export function useDeleteGroup() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (group: { id: string; members: number }) => {
      const { error } = await createClient()
        .from("worker_groups")
        .delete()
        .eq("id", group.id)
        .eq("owner_id", user.id);
      if (error) throw error;
      track("worker_group_deleted", { members: group.members });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: workerKeys.all(user.id) }),
  });
}
