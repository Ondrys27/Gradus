import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Who works in a space now (28.1): the owner and the workers whose
 * membership is active (active_members() in the database). The one list
 * every picker and list of people uses: rewards, groups, task and deal
 * people, filters, messages, stats, the scheduler's team. Removed, departed
 * and never accepted people are not in it; history (who did what, old
 * messages) keeps its own names.
 */
export type ActiveMember = {
  userId: string;
  /** The worker record; null for the owner. */
  workerId: string | null;
  isOwner: boolean;
  name: string;
  avatarUrl: string | null;
  username: string | null;
  jobTitle: string | null;
};

export const activeMemberKeys = {
  // Under "workers", so any change of a worker refreshes the list too.
  space: (userId: string, space: string) => ["workers", userId, "active-members", space] as const,
};

/** Members of the space only; anybody else gets an empty list. */
export async function fetchActiveMembers(
  db: SupabaseClient<Database>,
  space: string,
): Promise<ActiveMember[]> {
  const { data, error } = await db.rpc("active_members", { _space: space });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    workerId: row.worker_id ?? null,
    isOwner: row.is_owner,
    name: row.name ?? "",
    avatarUrl: row.avatar_url ?? null,
    username: row.username ?? null,
    jobTitle: row.job_title ?? null,
  }));
}

/** Worker record ids of the active members, for lists built from the owner's worker records. */
export function activeWorkerIds(members: readonly ActiveMember[] | undefined): ReadonlySet<string> {
  return new Set((members ?? []).flatMap((member) => (member.workerId ? [member.workerId] : [])));
}
