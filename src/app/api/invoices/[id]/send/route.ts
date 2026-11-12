import { NextResponse } from "next/server";
import { toFailure } from "@/features/invoices/errors";
import { invoiceEmailSchema } from "@/features/invoices/schemas";
import { invoiceContext } from "@/features/invoices/server/context";
import { sendInvoiceEmail } from "@/features/invoices/server/send";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 16 * 1024;

/** "Send by e-mail" from the invoice screen (sendInvoiceEmail does the work). */
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
    await sendInvoiceEmail(ctx, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const failure = toFailure(error);
    if (failure.error === "unknown") console.error("invoice send route failed", error);
    return NextResponse.json({ error: failure.error }, { status: 400 });
  }
}
