import "server-only";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildInvoiceDocument, type DocText } from "../document/model";
import { InvoiceError } from "../errors";
import {
  INVOICE_RECORD_COLUMNS,
  PROFILE_COLUMNS,
  supplierFromProfile,
  toInvoiceRecord,
  type InvoiceProfile,
  type InvoiceRecord,
  type SupplierSnapshot,
} from "../types";
import { loadFormats, type InvoiceContext } from "./context";
import { renderInvoicePdf } from "./pdf";

export const INVOICES_BUCKET = "invoices";
/** Signed links to a PDF live this long; the browser opens them at once. */
export const SIGNED_URL_SECONDS = 60;

/** An issued invoice the caller may see; RLS on invoices decides. */
export async function loadIssuedInvoice(ctx: InvoiceContext, id: string): Promise<InvoiceRecord> {
  const { data, error } = await ctx.supabase
    .from("invoices")
    .select(INVOICE_RECORD_COLUMNS)
    .eq("user_id", ctx.workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new InvoiceError("invoiceNotFound");
  const invoice = toInvoiceRecord(data);
  if (invoice.status === "draft" || !invoice.number) throw new InvoiceError("notIssued");
  return invoice;
}

export function pdfPathFor(invoice: Pick<InvoiceRecord, "user_id" | "id">): string {
  return `${invoice.user_id}/${invoice.id}.pdf`;
}

export function pdfFileName(invoice: Pick<InvoiceRecord, "number">): string {
  return `${(invoice.number ?? "invoice").replace(/[^A-Za-z0-9-]/g, "_")}.pdf`;
}

/** Old invoices issued before the supplier had a profile print the profile as it is now. */
async function supplierOf(ctx: InvoiceContext, invoice: InvoiceRecord): Promise<SupplierSnapshot> {
  if (invoice.supplier) return invoice.supplier;
  const { data } = await ctx.supabase
    .from("invoice_profiles")
    .select(PROFILE_COLUMNS)
    .eq("user_id", invoice.user_id)
    .maybeSingle();
  const profile = data as InvoiceProfile | null;
  return profile ? supplierFromProfile(profile) : {};
}

/** The PDF of an issued invoice, drawn from what was frozen when it was issued. */
export async function renderStoredInvoice(ctx: InvoiceContext, invoice: InvoiceRecord) {
  const [{ settings }, supplier, credited] = await Promise.all([
    loadFormats(ctx),
    supplierOf(ctx, invoice),
    invoice.credited_invoice_id
      ? ctx.supabase
          .from("invoices")
          .select("number")
          .eq("id", invoice.credited_invoice_id)
          .maybeSingle()
          .then(({ data }) => data?.number ?? null)
      : Promise.resolve(null),
  ]);
  const t = await getTranslations({ locale: invoice.locale, namespace: "invoices.document" });
  const text: DocText = (key, values) => t(key as never, values as never);
  const doc = buildInvoiceDocument(
    {
      kind: invoice.kind,
      number: invoice.number,
      creditForNumber: credited,
      issuedOn: invoice.issued_on,
      taxableOn: invoice.taxable_on,
      dueOn: invoice.due_on,
      currency: invoice.currency,
      supplier,
      customer: invoice.customer,
      items: invoice.items,
      vatMode: invoice.vat_mode,
      variableSymbol: invoice.variable_symbol,
      note: invoice.note,
      style: invoice.style ?? "clean",
      accent: invoice.accent_color,
      qr: invoice.qr_enabled,
      locale: invoice.locale,
    },
    text,
    settings,
  );
  return renderInvoicePdf(doc);
}

/**
 * The stored PDF of an issued invoice, made on first need. Only the server
 * writes the bucket (admin client), always under the invoice's own workspace
 * and id, after the caller's own client has shown the invoice is theirs.
 */
export async function ensureInvoicePdf(
  ctx: InvoiceContext,
  invoice: InvoiceRecord,
): Promise<{ path: string; bytes: Uint8Array | null }> {
  if (invoice.pdf_path) return { path: invoice.pdf_path, bytes: null };
  let bytes: Uint8Array;
  try {
    bytes = await renderStoredInvoice(ctx, invoice);
  } catch (error) {
    console.error("invoice pdf render failed", error);
    throw new InvoiceError("pdfFailed");
  }
  const path = pdfPathFor(invoice);
  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from(INVOICES_BUCKET)
    .upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (uploadError) {
    console.error("invoice pdf upload failed", uploadError);
    throw new InvoiceError("pdfFailed");
  }
  const { error: updateError } = await admin
    .from("invoices")
    .update({ pdf_path: path })
    .eq("id", invoice.id)
    .eq("user_id", invoice.user_id);
  if (updateError) console.error("invoice pdf path not saved", updateError);
  return { path, bytes };
}

/** The bytes of the stored PDF, read with the caller's own client (storage RLS). */
export async function downloadInvoicePdf(ctx: InvoiceContext, invoice: InvoiceRecord): Promise<Uint8Array> {
  const stored = await ensureInvoicePdf(ctx, invoice);
  if (stored.bytes) return stored.bytes;
  const { data, error } = await ctx.supabase.storage.from(INVOICES_BUCKET).download(stored.path);
  if (error || !data) throw new InvoiceError("pdfFailed");
  return new Uint8Array(await data.arrayBuffer());
}
