/**
 * What can go wrong sending an e-mail, as keys under `email.compose.errors`.
 * The server action returns these instead of throwing (Next.js hides thrown
 * messages in production).
 */
export const EMAIL_ERROR_CODES = [
  "contactNotFound",
  "noAddress",
  "fileType",
  "fileTooLarge",
  "fileMissing",
  "tooManyFiles",
  "sendFailed",
  "readOnly",
  "unknown",
] as const;
export type EmailErrorCode = (typeof EMAIL_ERROR_CODES)[number];

export type ActionResult<T> =
  | { ok: true; data: T }
  /** `detail` carries Resend's own words for a rejected send, when it gave any. */
  | { ok: false; error: EmailErrorCode; detail?: string };

/** Thrown by the app's own steps on the server; the action turns it into a result. */
export class EmailError extends Error {
  constructor(
    readonly code: EmailErrorCode,
    readonly detail?: string,
  ) {
    super(`email_${code}`);
    this.name = "EmailError";
  }
}

export function toFailure(error: unknown): { ok: false; error: EmailErrorCode; detail?: string } {
  if (error instanceof EmailError) {
    return error.detail
      ? { ok: false, error: error.code, detail: error.detail }
      : { ok: false, error: error.code };
  }
  return { ok: false, error: "unknown" };
}

/** On the client: the data, or an EmailError the screen can name. */
export function unwrap<T>(result: ActionResult<T>): T {
  if (result.ok) return result.data;
  throw new EmailError(result.error, result.detail);
}

/** The code to show for a failed mutation, whatever it threw. */
export function errorCodeOf(error: unknown): { code: EmailErrorCode; detail?: string } {
  if (error instanceof EmailError) return { code: error.code, detail: error.detail };
  return { code: "unknown" };
}
