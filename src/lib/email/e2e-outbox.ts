import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { isE2eTestAccount } from "@/features/auth/e2e-account";
import { sendEmail, type EmailResult } from "./resend";

/**
 * The mock Resend of the end-to-end tests. Mail to a test account
 * (e2e-…@gradus.local) outside production never goes to Resend: it is kept
 * in this server process for a few minutes, where the tests read it through
 * GET /api/e2e/outbox (outside production, with a key derived from the
 * secret key). Any other @gradus.local address gets nothing at all. In
 * production every address is real mail.
 */

export type OutboxMail = {
  to: string;
  subject: string;
  text: string;
  html: string;
  at: number;
  /** The id the mock gave a booking e-mail (e2e_…), so a scheduled one can be cancelled. */
  id?: string;
  /** When a scheduled e-mail (a reminder) would go out. */
  scheduledAt?: string;
  cancelled?: boolean;
  /** Names of the attached files. */
  attachments?: string[];
};

const KEEP_MS = 10 * 60_000;
const MAX_KEPT = 100;
/** One list for the whole process: route handlers and server actions are bundled apart. */
const STORE = Symbol.for("gradus.e2eOutbox");

function store(): OutboxMail[] {
  const holder = globalThis as unknown as Record<symbol, OutboxMail[] | undefined>;
  holder[STORE] ??= [];
  return holder[STORE];
}

function prune(list: OutboxMail[], now: number) {
  const fresh = list.filter((mail) => now - mail.at < KEEP_MS).slice(-MAX_KEPT);
  list.splice(0, list.length, ...fresh);
}

export function keepE2eMail(mail: Omit<OutboxMail, "at">, now = Date.now()): void {
  const list = store();
  list.push({ ...mail, at: now });
  prune(list, now);
}

/** A scheduled e-mail of the mock is cancelled; false when there is none by that id. */
export function cancelE2eMail(id: string, now = Date.now()): boolean {
  const list = store();
  prune(list, now);
  const found = list.find((mail) => mail.id === id);
  if (!found) return false;
  found.cancelled = true;
  return true;
}

/** The kept mail of one test address, oldest first. */
export function readE2eMail(to: string, now = Date.now()): OutboxMail[] {
  const list = store();
  prune(list, now);
  const wanted = to.trim().toLowerCase();
  return list.filter((mail) => mail.to.toLowerCase() === wanted);
}

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
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<EmailResult> {
  if (isE2eTestAccount(message.to)) {
    keepE2eMail(message);
    return { ok: true, id: null };
  }
  if (/@gradus\.local$/i.test(message.to.trim())) return { ok: false, error: "internal address" };
  return sendEmail(message);
}
