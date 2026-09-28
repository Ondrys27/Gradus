"use server";

import { z } from "zod";
import { sendEmail } from "@/lib/email/resend";
import { createClient } from "@/lib/supabase/server";
import { EmailError, toFailure, type ActionResult } from "./errors";
import { ATTACHMENTS_BUCKET, bodyToHtml, isOwnEmailUploadPath, prepareAttachment } from "./service";
import { EMAIL_BODY_MAX, EMAIL_SUBJECT_MAX, emailSummary } from "./types";

/**
 * Sending an e-mail from a contact or a deal, called from the compose dialog.
 * The user id always comes from the session; failures come back as codes,
 * never thrown (Next.js hides a thrown message in production).
 */

const attachmentRefSchema = z.object({
  path: z.string().max(200),
  name: z.string().trim().min(1).max(255),
});

const sendEmailInputSchema = z.object({
  contactId: z.uuid(),
  dealId: z.uuid().nullish(),
  subject: z.string().trim().min(1).max(EMAIL_SUBJECT_MAX),
  body: z.string().trim().min(1).max(EMAIL_BODY_MAX),
  attachments: z.array(attachmentRefSchema).max(3).default([]),
});
export type SendEmailInput = z.input<typeof sendEmailInputSchema>;

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  return typeof userId === "string" && userId ? { supabase, userId } : null;
}

export async function sendEmailAction(
  input: SendEmailInput,
): Promise<ActionResult<{ activityLogged: boolean }>> {
  const parsed = sendEmailInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "unknown" };
  try {
    const ctx = await session();
    if (!ctx) return { ok: false, error: "unknown" };
    return { ok: true, data: await sendContactEmail(ctx.supabase, ctx.userId, parsed.data) };
  } catch (error) {
    const failure = toFailure(error);
    if (failure.error === "unknown") console.error("send email action failed", error);
    return failure;
  }
}

async function sendContactEmail(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  input: z.output<typeof sendEmailInputSchema>,
): Promise<{ activityLogged: boolean }> {
  // Read with the user's own client: RLS keeps it to their own contact.
  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id, email")
    .eq("id", input.contactId)
    .maybeSingle();
  if (contactError) throw contactError;
  if (!contact) throw new EmailError("contactNotFound");
  if (!contact.email) throw new EmailError("noAddress");

  // A deal id the user no longer has (or never had) is quietly dropped, not a hard failure.
  let dealId: string | null = null;
  if (input.dealId) {
    const { data: deal, error: dealError } = await supabase
      .from("deals")
      .select("id")
      .eq("id", input.dealId)
      .maybeSingle();
    if (dealError) throw dealError;
    dealId = deal?.id ?? null;
  }

  const ownPaths = input.attachments
    .map((ref) => ref.path)
    .filter((path) => isOwnEmailUploadPath(path, userId));
  if (ownPaths.length !== input.attachments.length) throw new EmailError("fileMissing");

  try {
    const built = await Promise.all(
      input.attachments.map(async (ref) => {
        const { data, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).download(ref.path);
        if (error || !data) throw new EmailError("fileMissing", ref.name);
        const bytes = new Uint8Array(await data.arrayBuffer());
        return prepareAttachment(bytes, ref.name);
      }),
    );

    const sent = await sendEmail({
      to: contact.email,
      subject: input.subject,
      text: input.body,
      html: bodyToHtml(input.body),
      attachments: built,
    });
    if (!sent.ok) throw new EmailError("sendFailed", sent.error);

    const { error: activityError } = await supabase.from("contact_activities").insert({
      user_id: userId,
      contact_id: input.contactId,
      deal_id: dealId,
      type: "email_sent",
      content: emailSummary(input.subject, input.body),
      occurred_at: new Date().toISOString(),
    });
    // The e-mail is already gone; a failed log entry is a lesser problem, not undone.
    if (activityError) console.error("email activity insert failed", activityError);
    return { activityLogged: !activityError };
  } finally {
    if (ownPaths.length) {
      const { error } = await supabase.storage.from(ATTACHMENTS_BUCKET).remove(ownPaths);
      if (error) console.error("email attachment cleanup failed", error);
    }
  }
}
