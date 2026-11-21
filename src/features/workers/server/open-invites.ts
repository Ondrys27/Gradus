import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * The owner's worker records whose invite can still be accepted: not
 * accepted, declined or replaced, and not past expires_at. An invited record
 * without one takes no seat (holdsSeat in plan/worker-seats.ts). Read with
 * the owner's client (RLS: their own invites) or the admin client filtered
 * by the owner.
 */
export async function openInviteWorkers(
  client: SupabaseClient<Database>,
  ownerId: string,
  now: Date = new Date(),
): Promise<Set<string>> {
  const { data, error } = await client
    .from("worker_invites")
    .select("worker_id")
    .eq("owner_id", ownerId)
    .is("accepted_at", null)
    .is("declined_at", null)
    .is("replaced_at", null)
    .gt("expires_at", now.toISOString())
    .limit(2000);
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.worker_id));
}
