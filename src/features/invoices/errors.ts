/**
 * What can go wrong with invoices, as keys under `finance.invoiceErrors`.
 * Server actions return these instead of throwing, because Next.js hides
 * thrown messages in production.
 */
export const INVOICE_ERROR_CODES = [
  "forbidden",
  "ownerOnly",
  "dealNotFound",
  "dealValueRequired",
  "invoiceNotFound",
  "readOnly",
  "invalid",
  "profileRequired",
  "customerRequired",
  "itemsRequired",
  "totalInvalid",
  "dueBeforeIssue",
  "alreadyIssued",
  "notCancellable",
  "notPayable",
  "notIssued",
  "pdfFailed",
  "noRecipient",
  "sendFailed",
  "aresInvalid",
  "aresNotFound",
  "aresUnavailable",
  "unknown",
] as const;
export type InvoiceErrorCode = (typeof INVOICE_ERROR_CODES)[number];

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: InvoiceErrorCode };

export class InvoiceError extends Error {
  constructor(readonly code: InvoiceErrorCode) {
    super(`invoice_${code}`);
    this.name = "InvoiceError";
  }
}

/** Database messages and the codes they stand for; the first match wins. */
const DATABASE_ERRORS: [string, InvoiceErrorCode][] = [
  ["deal_not_found", "dealNotFound"],
  ["deal_value_required", "dealValueRequired"],
  ["invoice_not_found", "invoiceNotFound"],
  ["invoice_profile_required", "profileRequired"],
  ["invoice_customer_required", "customerRequired"],
  ["invoice_items_required", "itemsRequired"],
  ["invoice_items_invalid", "invalid"],
  ["invoice_total_invalid", "totalInvalid"],
  ["invoice_due_before_issue", "dueBeforeIssue"],
  ["invoice_issued", "alreadyIssued"],
  ["invoice_not_cancellable", "notCancellable"],
  ["invoice_not_payable", "notPayable"],
  ["section_access_denied", "forbidden"],
  ["row-level security", "forbidden"],
  ["read_only", "readOnly"],
];

/** Anything thrown on the server, turned into a result the client can show. */
export function toFailure(error: unknown): { ok: false; error: InvoiceErrorCode } {
  if (error instanceof InvoiceError) return { ok: false, error: error.code };
  // Supabase errors are plain objects with a message, not Error instances.
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error ?? "");
  const known = DATABASE_ERRORS.find(([text]) => message.includes(text));
  return { ok: false, error: known ? known[1] : "unknown" };
}

/** On the client: the data, or an InvoiceError the screen can name. */
export function unwrap<T>(result: ActionResult<T>): T {
  if (result.ok) return result.data;
  throw new InvoiceError(result.error);
}

/** The code to show for a failed mutation, whatever it threw. */
export function errorCodeOf(error: unknown): InvoiceErrorCode {
  return error instanceof InvoiceError ? error.code : "unknown";
}
