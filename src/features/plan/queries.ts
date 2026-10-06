"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { createClient } from "@/lib/supabase/client";
import { toPlanSnapshot, type PlanSnapshot } from "./plan";

/** The trial can end while the app is open; this often the plan is read again. */
const PLAN_REFRESH_MS = 5 * 60_000;

export const planKeys = {
  plan: (userId: string, workspaceId: string) => ["account", userId, "plan", workspaceId] as const,
};

/**
 * The plan of the workspace the account works in. Seeded from the app start,
 * read again on focus and every few minutes, so the read-only state shows up
 * without a reload. The database enforces it either way.
 */
export function usePlan(): PlanSnapshot {
  const { user, worker, plan } = useSession();
  const workspaceId = worker?.ownerId ?? user.id;
  const { data } = useQuery({
    queryKey: planKeys.plan(user.id, workspaceId),
    queryFn: async () => {
      const { data, error } = await createClient().rpc("current_plan", { _user_id: workspaceId });
      if (error) throw error;
      return toPlanSnapshot(data?.[0] ?? null);
    },
    initialData: plan,
    initialDataUpdatedAt: Date.now(),
    staleTime: PLAN_REFRESH_MS,
    refetchInterval: PLAN_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
  return data;
}
