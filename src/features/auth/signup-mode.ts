import type { AuthErrorKey } from "./schemas";

/**
 * How a registration goes, decided on the server:
 * - the beta invite code → beta account, no end
 * - a worker invite → beta account bound to the owner's worker record
 * - no code, public sign-up on → 14-day trial
 * - no code, public sign-up off → refused (the website offers the waitlist)
 * A code that is neither is always refused, even with public sign-up on, so a
 * typo never silently turns an invited person into a trial.
 */
export type SignupDecision =
  | { kind: "beta" }
  | { kind: "worker" }
  | { kind: "trial" }
  | { kind: "error"; field?: "inviteCode"; error: AuthErrorKey };

export function decideSignup(input: {
  code: string;
  /** The code equals INVITE_CODE. */
  betaCodeMatches: boolean;
  /** The code is an open worker invite. */
  workerInviteFound: boolean;
  /** INVITE_CODE is configured at all. */
  betaCodeConfigured: boolean;
  publicSignup: boolean;
}): SignupDecision {
  const code = input.code.trim();
  if (!code) {
    return input.publicSignup
      ? { kind: "trial" }
      : { kind: "error", field: "inviteCode", error: "inviteRequired" };
  }
  if (input.betaCodeMatches) return { kind: "beta" };
  if (input.workerInviteFound) return { kind: "worker" };
  return input.betaCodeConfigured || input.publicSignup
    ? { kind: "error", field: "inviteCode", error: "invalidInvite" }
    : { kind: "error", error: "registrationClosed" };
}
