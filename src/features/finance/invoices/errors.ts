/**
 * What can go wrong with invoices, as keys under `finance.invoiceErrors`.
 * Server actions return these instead of throwing, because Next.js hides
 * thrown messages in production.
 */
export const INVOICE_ERROR_CODES = [
  "forbidden",
  "dealNotFound",
  "dealValueRequired",
  "invoiceNotFound",
  "readOnly",
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

/** Anything thrown on the server, turned into a result the client can show. */
export function toFailure(error: unknown): { ok: false; error: InvoiceErrorCode } {
  if (error instanceof InvoiceError) return { ok: false, error: error.code };
  // Supabase errors are plain objects with a message, not Error instances.
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error ?? "");
  if (message.includes("deal_not_found")) return { ok: false, error: "dealNotFound" };
  if (message.includes("deal_value_required")) return { ok: false, error: "dealValueRequired" };
  if (message.includes("invoice_not_found")) return { ok: false, error: "invoiceNotFound" };
  if (message.includes("section_access_denied")) return { ok: false, error: "forbidden" };
  if (message.includes("read_only")) return { ok: false, error: "readOnly" };
  return { ok: false, error: "unknown" };
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
