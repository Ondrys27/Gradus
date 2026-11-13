import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { looksLikeWorkerInvite } from "./invite-code";
import { inviteLinkStatus, type InviteLinkStatus } from "./invite-link";

export type OpenWorkerInvite = {
  workerName: string;
  /** The worker's e-mail as the owner entered it; registration must use it. */
  email: string | null;
  ownerName: string | null;
};

/** Everything a link's page needs, read with the admin client: the visitor may have no account. */
export type WorkerInviteLink = {
  status: InviteLinkStatus;
  /** The invite row while it exists (open or not); null for a deleted or unknown code. */
  invite: {
    ownerId: string;
    email: string | null;
    inviteeId: string | null;
  } | null;
  workerName: string | null;
  /** The worker's e-mail (as the owner entered it), else the invite's. */
  email: string | null;
  ownerName: string | null;
  companyName: string | null;
};

const UNKNOWN: WorkerInviteLink = {
  status: { state: "unknown", since: null },
  invite: null,
  workerName: null,
  email: null,
  ownerName: null,
  companyName: null,
};

/**
 * The state of an invite link and who it is for. Reading never changes the
 * invite: e-mail clients and link scanners open links before people do.
 */
export async function loadWorkerInviteLink(
  code: string,
  now: Date = new Date(),
): Promise<WorkerInviteLink> {
  const clean = code.trim();
  if (!looksLikeWorkerInvite(clean)) return UNKNOWN;
  const admin = createAdminClient();
  const { data: invite, error } = await admin
    .from("worker_invites")
    .select("worker_id, owner_id, email, invitee_id, expires_at, accepted_at, declined_at, replaced_at")
    .eq("code", clean)
    .maybeSingle();
  if (error) throw error;
  let tombstone: { owner_id: string; worker_id: string | null; reason: "revoked" | "replaced"; ended_at: string } | null =
    null;
  if (!invite) {
    const { data, error: tombError } = await admin
      .from("worker_invite_tombstones")
      .select("owner_id, worker_id, reason, ended_at")
      .eq("code", clean)
      .maybeSingle();
    if (tombError) throw tombError;
    tombstone = data
      ? { ...data, reason: data.reason === "replaced" ? "replaced" : "revoked" }
      : null;
    if (!tombstone) return UNKNOWN;
  }
  const ownerId = invite?.owner_id ?? tombstone!.owner_id;
  const workerId = invite?.worker_id ?? tombstone!.worker_id;
  const [worker, owner, invoice] = await Promise.all([
    workerId
      ? admin
          .from("workers")
          .select("name, email, status, user_id")
          .eq("id", workerId)
          .eq("owner_id", ownerId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin.from("profiles").select("display_name, company_name").eq("id", ownerId).maybeSingle(),
    admin.from("invoice_profiles").select("name").eq("user_id", ownerId).maybeSingle(),
  ]);
  if (worker.error) throw worker.error;
  const status = inviteLinkStatus(
    invite,
    tombstone,
    worker.data ? { status: worker.data.status, user_id: worker.data.user_id } : null,
    now,
  );
  return {
    status,
    invite: invite ? { ownerId, email: invite.email, inviteeId: invite.invitee_id } : null,
    workerName: worker.data?.name ?? null,
    email: worker.data?.email ?? invite?.email ?? null,
    ownerName: owner.data?.display_name?.trim() || null,
    companyName: owner.data?.company_name?.trim() || invoice.data?.name?.trim() || null,
  };
}

/**
 * An invite the registration can still take: open, for nobody's account yet.
 * Nothing is returned otherwise; the page says why from loadWorkerInviteLink.
 */
export async function findOpenWorkerInvite(code: string): Promise<OpenWorkerInvite | null> {
  const link = await loadWorkerInviteLink(code);
  if (link.status.state !== "open" || !link.invite || link.invite.inviteeId || !link.workerName) {
    return null;
  }
  return { workerName: link.workerName, email: link.email, ownerName: link.ownerName };
}

/** Whether an account already has this e-mail (then the invite is accepted after signing in). */
export async function accountExistsForEmail(email: string | null): Promise<boolean> {
  if (!email?.trim()) return false;
  const { data, error } = await createAdminClient().rpc("account_by_email", { _email: email });
  if (error) throw error;
  return Boolean(data);
}
