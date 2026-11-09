import "server-only";
import { randomUUID } from "node:crypto";
import { isE2eTestAccount } from "@/features/auth/e2e-account";
import { cancelE2eMail, keepE2eMail } from "@/lib/email/e2e-outbox";
import {
  cancelEmail,
  sendEmail,
  type EmailAttachment,
  type EmailResult,
} from "@/lib/email/resend";

/**
 * Sending the booking e-mails (24.4), now or scheduled (the reminders). A
 * test address (e2e-…@gradus.local outside production) goes to the mock
 * Resend with an id of its own, so the end-to-end tests see what would be
 * scheduled and what a move cancelled; other @gradus.local addresses get
 * nothing; everyone else real mail. Never throws.
 */

const E2E_PREFIX = "e2e_";

export type BookingDelivery = {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: EmailAttachment[];
  scheduledAt?: string;
  fromName?: string;
  replyTo?: string;
};

export async function deliverBookingMail(message: BookingDelivery): Promise<EmailResult> {
  if (isE2eTestAccount(message.to)) {
    const id = `${E2E_PREFIX}${randomUUID()}`;
    keepE2eMail({
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      id,
      ...(message.scheduledAt ? { scheduledAt: message.scheduledAt } : {}),
      ...(message.attachments?.length
        ? { attachments: message.attachments.map((file) => file.filename) }
        : {}),
    });
    return { ok: true, id };
  }
  if (/@gradus\.local$/i.test(message.to.trim())) return { ok: false, error: "internal address" };
  return sendEmail({
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    attachments: message.attachments,
    scheduledAt: message.scheduledAt,
    fromName: message.fromName,
    replyTo: message.replyTo,
  });
}

/** Cancels a scheduled e-mail (a reminder) by the id it was given. */
export async function cancelBookingMail(id: string): Promise<boolean> {
  if (id.startsWith(E2E_PREFIX)) return cancelE2eMail(id);
  return (await cancelEmail(id)).ok;
}
