import "server-only";
import type { EmailKind } from "./kinds";

/**
 * The mailbox of the end-to-end tests' mock Resend: mail to a test account
 * (e2e-…@gradus.local) outside production is kept here in the server process
 * for a few minutes instead of going to Resend. Apart from e2e-outbox.ts so
 * that sendEmail can use it without importing itself back.
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
  /** The kind of e-mail (kinds.ts), as sendEmail would log it. */
  kind?: EmailKind;
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
