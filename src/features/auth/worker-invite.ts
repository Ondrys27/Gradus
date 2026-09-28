import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { looksLikeWorkerInvite } from "./invite-code";

export type OpenWorkerInvite = {
  workerName: string;
  /** The worker's e-mail as the owner entered it; registration must use it. */
  email: string | null;
  ownerName: string | null;
};

/**
 * An invite that can still be used, read with the admin client: the person
 * registering has no account yet. Nothing is returned for used, expired or
 * unknown codes, so the page cannot tell them apart.
 */
export async function findOpenWorkerInvite(code: string): Promise<OpenWorkerInvite | null> {
  const clean = code.trim();
  if (!looksLikeWorkerInvite(clean)) return null;
  const admin = createAdminClient();
  const { data: invite, error } = await admin
    .from("worker_invites")
    .select("worker_id, owner_id, expires_at, accepted_at")
    .eq("code", clean)
    .maybeSingle();
  if (error) throw error;
  if (!invite || invite.accepted_at || Date.parse(invite.expires_at) <= Date.now()) return null;

  const [worker, owner] = await Promise.all([
    admin
      .from("workers")
      .select("name, email, user_id")
      .eq("id", invite.worker_id)
      .eq("owner_id", invite.owner_id)
      .maybeSingle(),
    admin.from("profiles").select("display_name").eq("id", invite.owner_id).maybeSingle(),
  ]);
  if (worker.error) throw worker.error;
  if (!worker.data || worker.data.user_id) return null;
  return {
    workerName: worker.data.name,
    email: worker.data.email,
    ownerName: owner.data?.display_name ?? null,
  };
}
