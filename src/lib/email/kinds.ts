/**
 * Every kind of e-mail the app sends (30.1): sendEmail() requires one and
 * writes it to email_log, the administration's E-mails widget counts by it.
 * docs/emaily.md describes each (when, to whom, how many a month); a new
 * e-mail = a new key here and a row there.
 */
export const EMAIL_KINDS = [
  "auth_confirmation",
  "account_support",
  "admin_login",
  "admin_invite",
  "admin_peer_notice",
  "admin_digest",
  "error_alert",
  "ai_budget",
  "billing_alert",
  "plan_request",
  "feature_request",
  "bug_report_owner",
  "bug_report_thanks",
  "welcome_beta",
  "waitlist_confirm",
  "worker_invite",
  "worker_left",
  "chat_notification",
  "invoice",
  "contact_email",
  "booking_guest",
  "booking_host",
  "booking_reminder",
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export function isEmailKind(value: unknown): value is EmailKind {
  return typeof value === "string" && (EMAIL_KINDS as readonly string[]).includes(value);
}

/** The pattern email_log.kind checks (a new key needs no migration). */
export const EMAIL_KIND_PATTERN = /^[a-z][a-z0-9_]{1,40}$/;

/**
 * Resend's plans (resend.com/pricing, checked 2026-11-26): e-mails a month
 * and, on the free plan, a day. The page does not say when a scheduled e-mail
 * counts; the widget counts it on the day it was handed to Resend.
 */
export const RESEND_PLANS = {
  free: { monthly: 3_000, daily: 100 },
  pro: { monthly: 50_000, daily: null },
  scale: { monthly: 100_000, daily: null },
} as const;
export type ResendPlan = keyof typeof RESEND_PLANS;
/** The plan Gradus is on (change it here when the plan changes). */
export const RESEND_PLAN: ResendPlan = "free";
export const RESEND_LIMITS_CHECKED_ON = "2026-11-26";
