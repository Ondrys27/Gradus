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

export type EmailResult = { ok: true; id: string | null } | { ok: false; error: string };

/** Sends one e-mail. Never throws: a failed e-mail must not undo what caused it. */
export async function sendEmail(message: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set" };
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: senderAddress(),
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(10_000),
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
