import type { AMREntry } from "@supabase/supabase-js";

/** How long after opening the reset link the new password may be set. */
export const RECOVERY_WINDOW_SECONDS = 60 * 60;

/** Sign-in methods a password-reset link produces (the name differs by flow). */
const EMAIL_LINK_METHODS = new Set(["recovery", "otp", "magiclink"]);

/**
 * True when the session was opened by an e-mail link within the recovery window.
 * An ordinary password session must go through "change password" and prove the
 * current password instead, so a stolen or unattended session cannot take over
 * the account.
 */
export function isFreshRecoverySession(
  amr: AMREntry[] | string[] | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!Array.isArray(amr)) return false;
  return amr.some(
    (entry) =>
      typeof entry === "object" &&
      EMAIL_LINK_METHODS.has(entry.method) &&
      nowSeconds - entry.timestamp <= RECOVERY_WINDOW_SECONDS,
  );
}
