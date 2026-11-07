import { z } from "zod";
import { APP_HOME_PATH, localizedPath, type SiteLocale } from "@/lib/routes";

/**
 * Helping one account from its detail in the administration (step 22.1):
 * a password reset link, a new confirmation link, signing out everywhere and
 * a changed e-mail. Every action needs a reason, goes to admin_audit before
 * it happens and is offered only when it can work. Pure rules here, the
 * actions in server/account-support-actions.ts.
 */

export const SUPPORT_ACTIONS = ["passwordReset", "confirmation", "signOut", "emailChange"] as const;
export type SupportAction = (typeof SUPPORT_ACTIONS)[number];

/** admin_audit.target of each action; identifiers only. */
export const SUPPORT_AUDIT_TARGET: Record<SupportAction, string> = {
  passwordReset: "users.password_reset",
  confirmation: "users.confirmation_resend",
  signOut: "users.sign_out",
  emailChange: "users.email_change",
};

/** The change of the e-mail, once the new address confirmed it. */
export const EMAIL_CHANGE_CONFIRMED_TARGET = "users.email_change.confirmed";

/** Actions that send the person an e-mail, and how many of them one account gets in an hour. */
export const SUPPORT_EMAIL_ACTIONS: readonly SupportAction[] = [
  "passwordReset",
  "confirmation",
  "emailChange",
];
export const SUPPORT_EMAILS_PER_HOUR = 5;

export const SUPPORT_REASON_MIN = 3;
export const SUPPORT_REASON_MAX = 300;

/** Why: required, a short sentence for the audit. */
export const supportReasonSchema = z
  .string()
  .trim()
  .min(SUPPORT_REASON_MIN)
  .max(SUPPORT_REASON_MAX);

export const newEmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(320));

export type SupportError =
  | "invalid"
  | "forbidden"
  | "blocked"
  | "notFound"
  | "limit"
  | "notNeeded"
  | "sameEmail"
  | "taken"
  | "noEmail"
  | "failed";

export type SupportResult = { ok: true } | { ok: false; error: SupportError };

/** What the detail knows about an account when it offers the actions. */
export type SupportAccount = { email: string | null; emailConfirmed: boolean };

/** The actions that can work for this account now (the confirmation only while it is missing). */
export function availableSupportActions(account: SupportAccount): SupportAction[] {
  if (!account.email) return ["signOut"];
  return SUPPORT_ACTIONS.filter((action) => action !== "confirmation" || !account.emailConfirmed);
}

/** The audit row's detail: whom it was about and why. Never the link, never the new address. */
export function supportAuditDetail(userId: string, reason: string): { user: string; reason: string } {
  return { user: userId, reason: reason.trim().slice(0, SUPPORT_REASON_MAX) };
}

function confirmUrl(origin: string, tokenHash: string, type: string, next: string): string {
  const params = new URLSearchParams({ token_hash: tokenHash, type, next });
  return `${origin}/auth/confirm?${params.toString()}`;
}

/** The reset link: /auth/confirm verifies the token, then the new password page in the person's language. */
export function recoveryLink(origin: string, tokenHash: string, locale: SiteLocale): string {
  return confirmUrl(origin, tokenHash, "recovery", localizedPath("resetPassword", locale));
}

/**
 * A new confirmation link for an account that never confirmed its e-mail:
 * a one-time sign-in link, whose use confirms the address, then the app.
 */
export function confirmationLink(origin: string, tokenHash: string): string {
  return confirmUrl(origin, tokenHash, "magiclink", APP_HOME_PATH);
}

/** The page where the new address confirms the change. */
export function emailChangeLink(origin: string, token: string, locale: SiteLocale): string {
  return `${origin}${localizedPath("emailChange", locale)}?token=${encodeURIComponent(token)}`;
}

export type TrialState =
  | { kind: "none" }
  | { kind: "running"; endsAt: string; daysLeft: number }
  | { kind: "ended"; endsAt: string };

/** Where the account's trial is: none, running with days left (rounded up), or over. */
export function trialState(
  subscription: { status: string; trialEndsAt: string | null } | null,
  now: Date = new Date(),
): TrialState {
  const endsAt = subscription?.trialEndsAt;
  if (!subscription || !endsAt) return { kind: "none" };
  const left = new Date(endsAt).getTime() - now.getTime();
  if (subscription.status === "trialing" && left > 0) {
    return { kind: "running", endsAt, daysLeft: Math.max(1, Math.ceil(left / 86_400_000)) };
  }
  return { kind: "ended", endsAt };
}
