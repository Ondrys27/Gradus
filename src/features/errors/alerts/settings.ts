/**
 * Where the e-mails about errors go and how often (app_settings
 * 'error_alerts'). Pure: the stored shape, its limits, the defaults and the
 * flood rules. The database checks the same (valid_error_alerts) and decides
 * each e-mail in error_alert_claim().
 */
import { z } from "zod";

export const ERROR_ALERT_MODES = ["every", "digest"] as const;
export type ErrorAlertMode = (typeof ERROR_ALERT_MODES)[number];

/** Addresses the alerts go to, at most. */
export const MAX_ALERT_EMAILS = 10;
export const DIGEST_MINUTES_MIN = 5;
export const DIGEST_MINUTES_MAX = 1440;
export const DEFAULT_DIGEST_MINUTES = 15;

/**
 * A plain address in lower case; the database uses the same pattern, so an
 * address the form accepts is never refused there.
 */
export const ALERT_EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,63}$/;
const EMAIL_MAX = 254;

/** The flood rules: one e-mail per error per window, a cap per hour. */
export const ERROR_ALERT_LIMITS = {
  /** The same error (fingerprint) is e-mailed at most once in this many minutes. */
  fingerprintMinutes: 15,
  /** E-mails about errors (single and summaries) per rolling hour. */
  perHour: 30,
  /** Test e-mails from the administration per hour. */
  testsPerHour: 5,
} as const;

/** When the daily summary of the digest mode goes out (vercel.json, cron 0 7 * * *). */
export const DIGEST_HOUR_UTC = 7;

export type ErrorAlertSettings = {
  emails: string[];
  mode: ErrorAlertMode;
  digest_minutes: number;
};

export const DEFAULT_ERROR_ALERTS: ErrorAlertSettings = {
  emails: [],
  mode: "every",
  digest_minutes: DEFAULT_DIGEST_MINUTES,
};

/** An address as stored: trimmed, lower case; null when it is not one. */
export function normalizeAlertEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (!email || email.length > EMAIL_MAX || !ALERT_EMAIL_PATTERN.test(email)) return null;
  return email;
}

const emailSchema = z.string().max(EMAIL_MAX).regex(ALERT_EMAIL_PATTERN);

export const errorAlertSettingsSchema = z.strictObject({
  emails: z
    .array(emailSchema)
    .max(MAX_ALERT_EMAILS)
    .refine((emails) => new Set(emails).size === emails.length, "duplicate"),
  mode: z.enum(ERROR_ALERT_MODES),
  digest_minutes: z.number().int().min(DIGEST_MINUTES_MIN).max(DIGEST_MINUTES_MAX),
});

/** The stored value, or the defaults (no addresses) when there is none or it is unreadable. */
export function resolveErrorAlerts(stored: unknown): ErrorAlertSettings & { stored: boolean } {
  const parsed = errorAlertSettingsSchema.safeParse(stored);
  return parsed.success
    ? { ...parsed.data, stored: true }
    : { ...DEFAULT_ERROR_ALERTS, stored: false };
}

/** What the form sends: addresses as typed (normalised here), the mode and N as text. */
export const errorAlertFormSchema = z.strictObject({
  emails: z.array(z.string().max(1000)).max(MAX_ALERT_EMAILS * 2),
  mode: z.enum(ERROR_ALERT_MODES),
  digestMinutes: z.string().max(10),
});
export type ErrorAlertForm = z.infer<typeof errorAlertFormSchema>;

export type ErrorAlertFormProblem = "emails" | "tooMany" | "duplicate" | "digestMinutes";

/** The form's values as the stored setting, or what is wrong with them. */
export function toStoredErrorAlerts(
  form: ErrorAlertForm,
): { ok: true; value: ErrorAlertSettings } | { ok: false; problems: ErrorAlertFormProblem[] } {
  const problems: ErrorAlertFormProblem[] = [];
  const emails = form.emails.map(normalizeAlertEmail);
  if (emails.some((email) => email === null)) problems.push("emails");
  const valid = emails.filter((email): email is string => email !== null);
  if (new Set(valid).size !== valid.length) problems.push("duplicate");
  if (valid.length > MAX_ALERT_EMAILS) problems.push("tooMany");
  const minutes = Number(form.digestMinutes.trim());
  const minutesOk =
    Number.isInteger(minutes) && minutes >= DIGEST_MINUTES_MIN && minutes <= DIGEST_MINUTES_MAX;
  // N matters only for the digest; in the other mode the stored N is kept as it is.
  if (form.mode === "digest" && !minutesOk) problems.push("digestMinutes");
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    value: {
      emails: valid,
      mode: form.mode,
      digest_minutes: minutesOk ? minutes : DEFAULT_DIGEST_MINUTES,
    },
  };
}
