import { NextResponse } from "next/server";
import { bodyToHtml } from "@/features/email/service";
import { InvoiceError, toFailure } from "@/features/invoices/errors";
import { invoiceEmailSchema } from "@/features/invoices/schemas";
import { invoiceContext, requireEditFinance } from "@/features/invoices/server/context";
import { downloadInvoicePdf, loadIssuedInvoice, pdfFileName } from "@/features/invoices/server/store";
import { track } from "@/lib/analytics/track";
import { sendEmail } from "@/lib/email/resend";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 16 * 1024;

/**
 * "Send by e-mail": the invoice's PDF to the customer through Resend, a copy
 * to the user when asked, replies going to the user. The supplier's name is
 * the sender's; the address stays the verified one of RESEND_FROM.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "invalid" }, { status: 415 });
  }
  const text = await request.text().catch(() => "");
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "invalid" }, { status: 413 });
  }
  const { id } = await params;
  let payload: unknown = null;
  try {
    payload = { ...JSON.parse(text), invoiceId: id };
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const parsed = invoiceEmailSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  try {
    const ctx = await invoiceContext();
    if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 401 });
    await requireEditFinance(ctx);
    const invoice = await loadIssuedInvoice(ctx, parsed.data.invoiceId);
    const bytes = await downloadInvoicePdf(ctx, invoice);
    const self = ctx.email && ctx.email !== parsed.data.to ? ctx.email : null;
    const sent = await sendEmail({
      to: parsed.data.to,
      cc: parsed.data.ccSelf && self ? [self] : undefined,
      replyTo: ctx.email ?? invoice.supplier?.email ?? undefined,
      fromName: invoice.supplier?.name,
      subject: parsed.data.subject,
      text: parsed.data.body,
      html: bodyToHtml(parsed.data.body),
      attachments: [{ filename: pdfFileName(invoice), content: Buffer.from(bytes).toString("base64") }],
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
    await track("invoice_sent", { cc_self: Boolean(parsed.data.ccSelf && self) });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const failure = toFailure(error);
    if (failure.error === "unknown") console.error("invoice send route failed", error);
    return NextResponse.json({ error: failure.error }, { status: 400 });
  }
}
