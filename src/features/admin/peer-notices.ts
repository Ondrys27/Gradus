import { ADMIN_PATH } from "./access";
import type { AdminLevel, AdminRole } from "./roles";

/**
 * "Váša changed …" (step 27.2): when the owner or a full administrator
 * publishes plans or changes AI caps, the other ones who may change the
 * same things get one e-mail, unless they switched it off. Pure rules here;
 * the sending is in server/peer-notices.ts.
 */

export const PEER_CHANGES = ["plansPublished", "plansRestored", "aiCaps", "aiUserCap"] as const;
export type PeerChange = (typeof PEER_CHANGES)[number];

export type PeerCandidate = {
  userId: string;
  role: AdminRole;
  level: AdminLevel;
  email: string | null;
  /** False when they switched the e-mails off. */
  wantsMail: boolean;
};

const TEST_DOMAIN = /@gradus\.local$/i;

/**
 * Who hears about a change: the owner and the full administrators other
 * than the one who made it, with an address and the e-mails on. A change
 * made by a test account (@gradus.local, the end-to-end tests) reaches only
 * other test accounts, never a real person's inbox.
 */
export function peerRecipients(
  actor: { userId: string; email: string | null },
  candidates: readonly PeerCandidate[],
): PeerCandidate[] {
  const actorIsTest = TEST_DOMAIN.test(actor.email?.trim() ?? "");
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (candidate.userId === actor.userId || seen.has(candidate.userId)) return false;
    if (candidate.role !== "owner" && candidate.level !== "full") return false;
    if (!candidate.wantsMail || !candidate.email) return false;
    if (actorIsTest && !TEST_DOMAIN.test(candidate.email.trim())) return false;
    seen.add(candidate.userId);
    return true;
  });
}

/** The page of the administration each change is about. */
export function peerChangePath(change: PeerChange): string {
  return change === "plansPublished" || change === "plansRestored"
    ? `${ADMIN_PATH}/tarify`
    : `${ADMIN_PATH}/ai`;
}
