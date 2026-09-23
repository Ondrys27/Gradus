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
