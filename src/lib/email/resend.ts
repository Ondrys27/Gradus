import "server-only";
import { APP_NAME } from "@/lib/constants";

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

export type EmailResult = { ok: true; id: string | null } | { ok: false; error: string };

/** One file attached to an outgoing e-mail; `content` is base64, no attachments have Resend limits by size. */
export type EmailAttachment = { filename: string; content: string };

/** Sends one e-mail. Never throws: a failed e-mail must not undo what caused it. */
export async function sendEmail(message: {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: EmailAttachment[];
  /** Another display name in front of the sender's address (an invoice comes from the supplier). */
  fromName?: string;
  cc?: string[];
  replyTo?: string;
}): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set" };
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: message.fromName ? namedSender(message.fromName) : senderAddress(),
        to: [message.to],
        ...(message.cc?.length ? { cc: message.cc } : {}),
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        subject: message.subject,
        text: message.text,
        html: message.html,
        ...(message.attachments?.length ? { attachments: message.attachments } : {}),
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
      return {
        ok: false,
        error: `${response.status} ${body?.name ?? ""} ${body?.message ?? ""}`.trim(),
      };
    }
    return { ok: true, id: body?.id ?? null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
