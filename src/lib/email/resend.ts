import "server-only";
import { isE2eTestAccount } from "@/features/auth/e2e-account";
import { APP_NAME } from "@/lib/constants";
import { keepE2eMail } from "./e2e-mailbox";
import { escapeHtmlText } from "./escape";
import type { EmailKind } from "./kinds";
import { logEmail, logEmailCancelled } from "./log";

const ENDPOINT = "https://api.resend.com/emails";

/**
 * Until a domain is verified on Resend, mail can only come from its shared
 * test address and go to the account owner's own address. RESEND_FROM
 * switches to the real sender once the domain is set up.
 */
export function senderAddress(): string {
  return process.env.RESEND_FROM || `${APP_NAME} <onboarding@resend.dev>`;
}

/** The sender's address with another name: `"Jana Nováková" <invoices@example.com>`. */
export function namedSender(name: string): string {
  const from = senderAddress();
  const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
  const clean = name.replace(/["\\<>\r\n]/g, "").trim().slice(0, 100);
  return clean ? `"${clean}" <${address}>` : from;
}

/**
 * The names kept for examples (RFC 2606, RFC 6761): example.com / .net /
 * .org and anything under .example, .invalid or .test. No mail can ever
 * arrive there, so sendEmail never tries.
 */
export function isReservedAddress(address: string): boolean {
  const domain = address.trim().toLowerCase().split("@").pop() ?? "";
  return (
    /^(?:.+\.)?example\.(?:com|net|org)$/.test(domain) ||
    /\.(?:example|invalid|test)$/.test(domain)
  );
}

/**
 * Our own made-up addresses (the tests' e2e-…@gradus.local, the showcase's
 * accounts). They have no inbox: every e-mail to them bounces and still
 * counts against the Resend limit, so sendEmail never sends one.
 */
export function isInternalAddress(address: string): boolean {
  return /@gradus\.local$/i.test(address.trim());
}

export type EmailResult = { ok: true; id: string | null } | { ok: false; error: string };

/** One file attached to an outgoing e-mail; `content` is base64, no attachments have Resend limits by size. */
export type EmailAttachment = { filename: string; content: string };

/**
 * Sends one e-mail. Never throws: a failed e-mail must not undo what caused
 * it. The one place every e-mail of the app leaves through, so each one that
 * reaches Resend is written to email_log with its `kind` (kinds.ts).
 */
export async function sendEmail(message: {
  /** What e-mail this is, for email_log and the administration's E-mails widget. */
  kind: EmailKind;
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: EmailAttachment[];
  /** Another display name in front of the sender's address (an invoice comes from the supplier). */
  fromName?: string;
  cc?: string[];
  replyTo?: string;
  /** ISO instant: Resend sends it then (at most 30 days ahead); the id cancels it. */
  scheduledAt?: string;
}): Promise<EmailResult> {
  // Nobody can receive mail there (the showcase's made-up clients and guests): nothing is sent.
  if (isReservedAddress(message.to)) return { ok: false, error: "reserved address" };
  // Our own addresses never reach Resend: the tests' accounts get the mock
  // outbox (outside production), any other one nothing.
  if (isInternalAddress(message.to)) {
    if (!isE2eTestAccount(message.to)) return { ok: false, error: "internal address" };
    keepE2eMail({
      kind: message.kind,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.scheduledAt ? { scheduledAt: message.scheduledAt } : {}),
      ...(message.attachments?.length
        ? { attachments: message.attachments.map((file) => file.filename) }
        : {}),
    });
    return { ok: true, id: null };
  }
  const cc = message.cc?.filter(
    (address) => !isReservedAddress(address) && !isInternalAddress(address),
  );
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set" };
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: message.fromName ? namedSender(message.fromName) : senderAddress(),
        to: [message.to],
        ...(cc?.length ? { cc } : {}),
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        subject: message.subject,
        text: message.text,
        html: message.html,
        ...(message.attachments?.length ? { attachments: message.attachments } : {}),
        ...(message.scheduledAt ? { scheduled_at: message.scheduledAt } : {}),
      }),
      // Attachments make the request slower than a plain notification e-mail.
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await response.json().catch(() => null)) as {
      id?: string;
      message?: string;
      name?: string;
    } | null;
    if (!response.ok) {
      await logEmail({ kind: message.kind, to: message.to, status: "failed" });
      return {
        ok: false,
        error: `${response.status} ${body?.name ?? ""} ${body?.message ?? ""}`.trim(),
      };
    }
    await logEmail({
      kind: message.kind,
      to: message.to,
      status: message.scheduledAt ? "scheduled" : "sent",
      providerId: body?.id ?? null,
      scheduledFor: message.scheduledAt ?? null,
    });
    return { ok: true, id: body?.id ?? null };
  } catch (error) {
    await logEmail({ kind: message.kind, to: message.to, status: "failed" });
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Cancels an e-mail scheduled with `scheduledAt`. Never throws; an e-mail already sent stays sent. */
export async function cancelEmail(id: string): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set" };
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return { ok: false, error: "invalid id" };
  try {
    const response = await fetch(`${ENDPOINT}/${id}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { ok: false, error: String(response.status) };
    await logEmailCancelled(id);
    return { ok: true, id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function escapeHtml(text: string): string {
  return escapeHtmlText(text);
}
