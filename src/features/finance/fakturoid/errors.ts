/**
 * What can go wrong with invoices and Fakturoid, as keys under
 * `finance.fakturoid.errors`. Server actions return these instead of throwing,
 * because Next.js hides thrown messages in production.
 */
export const INVOICE_ERROR_CODES = [
  "notConnected",
  "encryptionKeyMissing",
  "invalidCredentials",
  "accountNotFound",
  "forbidden",
  "validation",
  "rateLimited",
  "unavailable",
  "contactRequired",
  "dealNotFound",
  "dealValueRequired",
  "invoiceNotFound",
  "saveFailed",
  "readOnly",
  "unknown",
] as const;
export type InvoiceErrorCode = (typeof INVOICE_ERROR_CODES)[number];

export type ActionResult<T> =
  | { ok: true; data: T }
  /** `detail` carries Fakturoid's own words for a rejected document, when it gave any. */
  | { ok: false; error: InvoiceErrorCode; detail?: string };

/** An error from the Fakturoid API, already sorted into something the user can act on. */
export class FakturoidError extends Error {
  constructor(
    readonly code: InvoiceErrorCode,
    readonly httpStatus: number | null = null,
    readonly detail?: string,
  ) {
    super(`fakturoid_${code}${httpStatus ? `_${httpStatus}` : ""}`);
    this.name = "FakturoidError";
  }
}

/** Thrown by the app's own steps (not Fakturoid's) with a code for the user. */
export class InvoiceError extends Error {
  constructor(
    readonly code: InvoiceErrorCode,
    readonly detail?: string,
  ) {
    super(`invoice_${code}`);
    this.name = "InvoiceError";
  }
}

/** Anything thrown on the server, turned into a result the client can show. */
export function toFailure(error: unknown): { ok: false; error: InvoiceErrorCode; detail?: string } {
  if (error instanceof FakturoidError || error instanceof InvoiceError) {
    return error.detail
      ? { ok: false, error: error.code, detail: error.detail }
      : { ok: false, error: error.code };
  }
  // Supabase errors are plain objects with a message, not Error instances.
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error ?? "");
  if (message.includes("deal_not_found")) return { ok: false, error: "dealNotFound" };
  if (message.includes("deal_value_required")) return { ok: false, error: "dealValueRequired" };
  if (message.includes("invoice_not_found")) return { ok: false, error: "invoiceNotFound" };
  if (message.includes("invoice_managed_by_fakturoid")) return { ok: false, error: "notConnected" };
  return { ok: false, error: "unknown" };
}

/** On the client: the data, or an InvoiceError the screen can name. */
export function unwrap<T>(result: ActionResult<T>): T {
  if (result.ok) return result.data;
  throw new InvoiceError(result.error, result.detail);
}

/** A code stored earlier (the last sync's outcome) back as an error to show. */
export function errorFromCode(code: string): InvoiceError {
  const known = INVOICE_ERROR_CODES.find((item) => item === code);
  return new InvoiceError(known ?? "unknown");
}

/** The code to show for a failed mutation, whatever it threw. */
export function errorCodeOf(error: unknown): { code: InvoiceErrorCode; detail?: string } {
  if (error instanceof InvoiceError || error instanceof FakturoidError) {
    return { code: error.code, detail: error.detail };
  }
  return { code: "unknown" };
}

/** Maps an HTTP status from Fakturoid to a code. */
export function codeForStatus(status: number, phase: "token" | "request"): InvoiceErrorCode {
  if (phase === "token" && (status === 400 || status === 401 || status === 403)) {
    return "invalidCredentials";
  }
  if (status === 401) return "invalidCredentials";
  if (status === 402 || status === 403) return "forbidden";
  if (status === 404) return "accountNotFound";
  if (status === 422 || status === 400) return "validation";
  if (status === 429) return "rateLimited";
  if (status >= 500) return "unavailable";
  return "unknown";
}

/**
 * Fakturoid explains a rejected document as `{ errors: { field: [messages] } }`.
 * The messages are already in the account's language, so they are shown as they are.
 */
export function describeValidation(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const errors = (body as { errors?: unknown }).errors;
  if (!errors || typeof errors !== "object") return undefined;
  const parts: string[] = [];
  for (const [field, messages] of Object.entries(errors as Record<string, unknown>)) {
    const list = Array.isArray(messages) ? messages : [messages];
    for (const message of list) {
      if (typeof message === "string" && message.trim()) parts.push(`${field}: ${message.trim()}`);
    }
  }
  return parts.length ? parts.slice(0, 5).join("; ").slice(0, 400) : undefined;
}
