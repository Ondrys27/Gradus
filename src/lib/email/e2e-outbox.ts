import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { isE2eTestAccount } from "@/features/auth/e2e-account";
import type { EmailKind } from "./kinds";
import { keepE2eMail } from "./e2e-mailbox";
import { sendEmail, type EmailResult } from "./resend";

/**
 * The mock Resend of the end-to-end tests. Mail to a test account
 * (e2e-…@gradus.local) outside production never goes to Resend: it is kept
 * in this server process for a few minutes, where the tests read it through
 * GET /api/e2e/outbox (outside production, with a key derived from the
 * secret key). Any other @gradus.local address gets nothing at all, in
 * production too (sendEmail itself never sends to @gradus.local).
 */

export {
  cancelE2eMail,
  keepE2eMail,
  readE2eMail,
  type OutboxMail,
} from "./e2e-mailbox";

/** The value of the x-gradus-e2e-key header: a hash of the secret key, never the key. */
export function e2eOutboxKey(secret: string): string {
  return createHash("sha256").update(`gradus-e2e-outbox:${secret}`).digest("hex");
}

export function e2eOutboxAllowed(
  header: string | null,
  secret: string | undefined,
  vercelEnv: string | undefined = process.env.VERCEL_ENV,
): boolean {
  if (vercelEnv === "production" || !secret || !header) return false;
  const expected = Buffer.from(e2eOutboxKey(secret));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * One e-mail to a person's own address (their password reset, their new
 * confirmation link): Resend for real addresses, the outbox for the tests'
 * accounts, nothing for other internal addresses. Never throws.
 */
export async function deliverEmail(message: {
  kind: EmailKind;
  to: string;
  subject: string;
  text: string;
  html: string;
  /** ISO instant: Resend (and the mock) send it then. */
  scheduledAt?: string;
}): Promise<EmailResult> {
  if (isE2eTestAccount(message.to)) {
    keepE2eMail(message);
    return { ok: true, id: null };
  }
  if (/@gradus\.local$/i.test(message.to.trim())) return { ok: false, error: "internal address" };
  return sendEmail(message);
}
