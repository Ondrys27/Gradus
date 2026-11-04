"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient, realtimeTopic, subscribeSignedIn } from "@/lib/supabase/client";
import { usePlan } from "@/features/plan/queries";
import { useSession } from "./queries";
import {
  GRANT_ROWS_LIMIT,
  grantsFromRows,
  type GrantAction,
  type GrantSection,
  type PermissionGrants,
} from "@/features/workers/permissions-catalog";
import {
  can,
  canAccessContacts,
  cleanGrants,
  sameGrants,
  workspaceFor,
  type AccessLevel,
  type Workspace,
} from "./workspace";

/** How often a worker's rights are read again when the live channel is quiet. */
const ACCESS_REFRESH_MS = 30_000;

export type WorkerAccessState = { active: boolean; grants: PermissionGrants };

export const workspaceKeys = {
  access: (userId: string, workerId: string) =>
    ["account", userId, "worker-access", workerId] as const,
};

/** The worker's record and rights as they are right now; RLS returns only their own. */
export async function fetchWorkerAccess(workerId: string): Promise<WorkerAccessState> {
  const supabase = createClient();
  const [worker, grants] = await Promise.all([
    supabase.from("workers").select("status").eq("id", workerId).maybeSingle(),
    supabase
      .from("worker_permission_grants")
      .select("section, action, allowed")
      .eq("worker_id", workerId)
      .limit(GRANT_ROWS_LIMIT),
  ]);
  if (worker.error) throw worker.error;
  if (grants.error) throw grants.error;
  return { active: worker.data?.status === "active", grants: grantsFromRows(grants.data) };
}

/**
 * A worker's live rights. Seeded from the snapshot loaded when the app
 * started, then kept current: read again on focus and every 30 s, and at once
 * when the owner changes them (see WorkspaceSync). Disabled for an owner.
 */
function useWorkerAccess() {
  const { user, worker } = useSession();
  return useQuery({
    queryKey: workspaceKeys.access(user.id, worker?.id ?? ""),
    queryFn: () => fetchWorkerAccess(worker!.id),
    enabled: Boolean(worker),
    initialData: worker
      ? { active: true, grants: cleanGrants(worker.grants) }
      : undefined,
    initialDataUpdatedAt: 0,
    refetchInterval: ACCESS_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * Whose space the account works in, its role there and what it may do.
 * Every query and mutation of a shared section filters by `id` and writes
 * rows with user_id = `id`; the database checks the same rights again.
 */
export function useWorkspace(): Workspace {
  const { user, worker } = useSession();
  const access = useWorkerAccess();
  const { readOnly } = usePlan();
  const grants = access.data?.grants;
  return useMemo(
    () => workspaceFor(user.id, worker, grants, readOnly),
    [user.id, worker, grants, readOnly],
  );
}

/** Shortcut for the id every shared query filters by. */
export function useWorkspaceId(): string {
  return useWorkspace().id;
}

/**
 * Whether the account may do this; hides what it may not (the database
 * enforces it anyway). "view" / "edit" of the six older sections are the
 * section as a whole, any other action the fine right of the catalog
 * (src/features/workers/permissions-catalog.ts), e.g. useCan("pipeline", "change_stage").
 */
export function useCan<S extends GrantSection>(section: S, action: GrantAction<S> | "edit"): boolean {
  const workspace = useWorkspace();
  return can(workspace, section, action);
}

/** Contacts and cold calling share their tables, so either right opens them. */
export function useCanContacts(level: AccessLevel): boolean {
  const workspace = useWorkspace();
  return canAccessContacts(workspace, level);
}

/**
 * Keeps a worker's rights live. Listens to the owner's changes of this
 * worker's record and permissions (Supabase Realtime, filtered by RLS), reads
 * them again, and when they really changed reloads every shared list so a
 * section taken away disappears and a new one fills without signing out. A
 * worker the owner deactivated is sent back through the app start, which
 * puts them into their own account.
 */
export function WorkspaceSync() {
  const { user, worker } = useSession();
  const queryClient = useQueryClient();
  const access = useWorkerAccess();
  const previous = useRef<PermissionGrants | null>(null);
  const workerId = worker?.id;

  useEffect(() => {
    if (!workerId) return;
    const supabase = createClient();
    const key = workspaceKeys.access(user.id, workerId);
    const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
    const channel = supabase
      .channel(realtimeTopic(`worker-access-${workerId}`))
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "worker_permissions",
          filter: `worker_id=eq.${workerId}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "worker_permission_grants",
          filter: `worker_id=eq.${workerId}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "workers", filter: `id=eq.${workerId}` },
        refresh,
      );
    return subscribeSignedIn(supabase, channel);
  }, [queryClient, user.id, workerId]);

  const state = access.data;
  useEffect(() => {
    if (!state) return;
    if (!state.active) {
      window.location.reload();
      return;
    }
    if (previous.current && !sameGrants(previous.current, state.grants)) {
      // Everything a section shows may have appeared or gone.
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== "account",
      });
    }
    previous.current = state.grants;
  }, [state, queryClient]);

  return null;
}
