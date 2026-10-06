import { z } from "zod";

/** A new confirmation e-mail goes out at most this often for one address. */
export const WAITLIST_RESEND_MINUTES = 10;
/** Addresses nobody confirmed are forgotten after this many days. */
export const WAITLIST_UNCONFIRMED_DAYS = 30;

/** Translation keys under `marketing.waitlist.errors`. */
export type WaitlistError = "invalidEmail" | "consentRequired" | "generic";

export type WaitlistState = { ok?: boolean; error?: WaitlistError; email?: string };

/**
 * The form: an e-mail, ticked consent, where on the site it came from, and a
 * field people never see (bots fill it in).
 */
export const waitlistSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email(),
  consent: z.literal("on"),
  source: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{1,40}$/)
    .catch("web"),
  website: z.string().max(0).optional().default(""),
});

export function waitlistError(issues: z.ZodError): WaitlistError {
  const fields = new Set(issues.issues.map((issue) => String(issue.path[0])));
  if (fields.has("email")) return "invalidEmail";
  if (fields.has("consent")) return "consentRequired";
  return "generic";
}

/** Whether a confirmation e-mail may go to this address again now. */
export function mayResend(lastSentAt: string | null, now: Date = new Date()): boolean {
  if (!lastSentAt) return true;
  return now.getTime() - Date.parse(lastSentAt) >= WAITLIST_RESEND_MINUTES * 60_000;
}
