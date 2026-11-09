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

/** Where a registration came from, for `signup_completed`. */
export const SIGNUP_SOURCES = ["web", "pricing", "invite", "code"] as const;
export type SignupSource = (typeof SIGNUP_SOURCES)[number];

/**
 * An invitation (beta code or a worker's) wins, then a partner's promo code,
 * then a plan picked on the pricing cards (home page or /cenik); anything
 * else is the website.
 */
export function signupSource(input: {
  kind: "beta" | "worker" | "trial";
  promoCode: boolean;
  planPicked: boolean;
}): SignupSource {
  if (input.kind !== "trial") return "invite";
  if (input.promoCode) return "code";
  return input.planPicked ? "pricing" : "web";
}

/**
 * The end-to-end tests turn public sign-up on for their own accounts without
 * changing the server's PUBLIC_SIGNUP_ENABLED: a request with this header,
 * outside production only. The registration page then shows the form as with
 * public sign-up; the action honours it only for e2e-…@gradus.local.
 */
export const E2E_PUBLIC_SIGNUP_HEADER = "x-gradus-e2e-signup";
export const E2E_PUBLIC_SIGNUP_VALUE = "public";

export function wantsE2ePublicSignup(
  headers: Pick<Headers, "get">,
  vercelEnv: string | undefined = process.env.VERCEL_ENV,
): boolean {
  if (vercelEnv === "production") return false;
  return headers.get(E2E_PUBLIC_SIGNUP_HEADER) === E2E_PUBLIC_SIGNUP_VALUE;
}
