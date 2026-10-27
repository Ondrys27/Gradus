import { NextResponse } from "next/server";
import { z } from "zod";
import { InvoiceError, toFailure } from "@/features/invoices/errors";
import { invoiceContext } from "@/features/invoices/server/context";
import {
  ensureInvoicePdf,
  INVOICES_BUCKET,
  loadIssuedInvoice,
  pdfFileName,
  SIGNED_URL_SECONDS,
} from "@/features/invoices/server/store";

export const runtime = "nodejs";

/**
 * The PDF of an issued invoice: made and stored on first need, then handed
 * out as a signed link valid for a minute. The link is signed with the
 * caller's own client, so storage RLS decides again: a worker without
 * finance gets nothing, also with the invoice's id in hand.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "invoiceNotFound" }, { status: 404 });
  }
  try {
    const ctx = await invoiceContext();
    if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 401 });
    const invoice = await loadIssuedInvoice(ctx, id);
    const { path } = await ensureInvoicePdf(ctx, invoice);
    const { data, error } = await ctx.supabase.storage
      .from(INVOICES_BUCKET)
      .createSignedUrl(path, SIGNED_URL_SECONDS, { download: pdfFileName(invoice) });
    if (error || !data) throw new InvoiceError("pdfFailed");
    return NextResponse.json({ url: data.signedUrl }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const failure = toFailure(error);
    if (failure.error === "unknown") console.error("invoice pdf route failed", error);
    const status = failure.error === "invoiceNotFound" ? 404 : failure.error === "forbidden" ? 403 : 400;
    return NextResponse.json({ error: failure.error }, { status });
  }
}
