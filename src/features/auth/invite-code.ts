import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compares the typed invite code with INVITE_CODE in constant time.
 * Only ever called from server actions; the code never reaches the browser.
 */
export function isValidInviteCode(input: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const digest = (value: string) => createHash("sha256").update(value.trim()).digest();
  return timingSafeEqual(digest(input), digest(expected));
}

/** Worker invite codes the database makes: 20 hex characters (12 for the first ones). */
export function looksLikeWorkerInvite(code: string): boolean {
  return /^[0-9a-f]{12,32}$/.test(code.trim());
}

/** The account e-mail must be the one the owner invited, when the owner gave one. */
export function inviteEmailMatches(invited: string | null, email: string): boolean {
  return !invited || invited.trim().toLowerCase() === email.trim().toLowerCase();
}
