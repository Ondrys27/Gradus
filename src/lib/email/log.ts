import "server-only";
import { fingerprint } from "@/features/admin/server/request-info";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EmailKind } from "./kinds";

export type EmailLogStatus = "sent" | "scheduled" | "failed" | "cancelled";

const PROVIDER_ID = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * One row of email_log per e-mail handed to Resend (30.1), written only here,
 * from sendEmail(): the kind, the recipient as a keyed hash (never the
 * address), the outcome and Resend's id (to mark a cancelled reminder).
 * Never throws and never delays the e-mail by more than the insert.
 */
export async function logEmail(entry: {
  kind: EmailKind;
  to: string;
  status: EmailLogStatus;
  providerId?: string | null;
  scheduledFor?: string | null;
}): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  try {
    const { error } = await createAdminClient()
      .from("email_log")
      .insert({
        kind: entry.kind,
        recipient_hash: fingerprint("email", entry.to),
        status: entry.status,
        provider_id: entry.providerId && PROVIDER_ID.test(entry.providerId) ? entry.providerId : null,
        scheduled_for: entry.scheduledFor ?? null,
      });
    if (error) console.error("[email-log] insert failed", error.code ?? error.message);
  } catch (error) {
    console.error("[email-log] insert failed", error instanceof Error ? error.message : "unknown");
  }
}

/** A scheduled e-mail that was cancelled before it went out: it no longer counts. */
export async function logEmailCancelled(providerId: string): Promise<void> {
  if (process.env.NODE_ENV === "test" || !PROVIDER_ID.test(providerId)) return;
  try {
    const { error } = await createAdminClient()
      .from("email_log")
      .update({ status: "cancelled" })
      .eq("provider_id", providerId)
      .eq("status", "scheduled");
    if (error) console.error("[email-log] cancel failed", error.code ?? error.message);
  } catch (error) {
    console.error("[email-log] cancel failed", error instanceof Error ? error.message : "unknown");
  }
}
