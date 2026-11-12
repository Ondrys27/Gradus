import "server-only";
import { bodyToHtml } from "@/features/email/service";
import { InvoiceError } from "@/features/invoices/errors";
import type { InvoiceEmailInput } from "@/features/invoices/schemas";
import { track } from "@/lib/analytics/track";
import { sendEmail } from "@/lib/email/resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireEditFinance, type InvoiceContext } from "./context";
import { downloadInvoicePdf, loadIssuedInvoice, pdfFileName } from "./store";

/**
 * "Send by e-mail": the invoice's PDF to the customer through Resend, a copy
 * to the user when asked, replies going to the user. The supplier's name is
 * the sender's; the address stays the verified one of RESEND_FROM. Shared by
 * the route of the invoice screen and Grady's tool (after the user's Confirm).
 */
export async function sendInvoiceEmail(
  ctx: InvoiceContext,
  input: Required<Pick<InvoiceEmailInput, "invoiceId" | "to" | "subject" | "body" | "ccSelf">>,
): Promise<void> {
  await requireEditFinance(ctx);
  const invoice = await loadIssuedInvoice(ctx, input.invoiceId);
  const bytes = await downloadInvoicePdf(ctx, invoice);
  const self = ctx.email && ctx.email !== input.to ? ctx.email : null;
  const sent = await sendEmail({
    to: input.to,
    cc: input.ccSelf && self ? [self] : undefined,
    replyTo: ctx.email ?? invoice.supplier?.email ?? undefined,
    fromName: invoice.supplier?.name,
    subject: input.subject,
    text: input.body,
    html: bodyToHtml(input.body),
    attachments: [
      { filename: pdfFileName(invoice), content: Buffer.from(bytes).toString("base64") },
    ],
  });
  if (!sent.ok) {
    console.error("invoice e-mail failed", sent.error);
    throw new InvoiceError("sendFailed");
  }
  // Sent is a fact about the issued invoice; only the server writes it.
  const { error } = await createAdminClient()
    .from("invoices")
    .update({
      sent_at: new Date().toISOString(),
      ...(invoice.status === "open" ? { status: "sent" as const } : {}),
    })
    .eq("id", invoice.id)
    .eq("user_id", invoice.user_id);
  if (error) console.error("invoice sent_at not saved", error);
  await track("invoice_sent", { cc_self: Boolean(input.ccSelf && self) });
}
