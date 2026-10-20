/**
 * The code of one error as the error page shows it (GR-7K3M9Q): short enough
 * to read out or type, made when the error is caught. It travels with the
 * client_error event and with the bug report, so the administration finds the
 * error by it. It carries nothing about the person or their data.
 */

/** No 0/O, 1/I/L or U: nothing that reads as another character. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const LENGTH = 6;
const PREFIX = "GR-";

export const ERROR_CODE_PATTERN = /^GR-[A-Z0-9]{6}$/;

export function isErrorCode(value: unknown): value is string {
  return typeof value === "string" && ERROR_CODE_PATTERN.test(value);
}

function randomIndexes(count: number): number[] {
  const bytes = new Uint8Array(count);
  globalThis.crypto.getRandomValues(bytes);
  // 256 is not a multiple of 30; the tiny bias does not matter for a lookup code.
  return Array.from(bytes, (byte) => byte % ALPHABET.length);
}

export function createErrorCode(): string {
  const body = randomIndexes(LENGTH)
    .map((index) => ALPHABET[index])
    .join("");
  // Never six digits in a row: analytics refuses those as a possible phone number.
  if (/^\d+$/.test(body)) return createErrorCode();
  return `${PREFIX}${body}`;
}

const codes = new WeakMap<object, string>();

/**
 * The code of a caught error: the same for the same error object (React
 * renders the error page more than once), a new one for every new error.
 */
export function errorCodeFor(error: unknown): string {
  if (typeof error !== "object" || error === null) return createErrorCode();
  let code = codes.get(error);
  if (!code) {
    code = createErrorCode();
    codes.set(error, code);
  }
  return code;
}

/**
 * What someone typed into the search for a code, as the beginning of a code:
 * upper case, without spaces, with the GR- prefix added when missing. Null
 * when it can not be (a part of) a code.
 */
export function normalizeErrorCodeQuery(query: string | null | undefined): string | null {
  const compact = (query ?? "").replace(/\s+/g, "").toUpperCase();
  if (!compact) return null;
  const body = compact.startsWith(PREFIX)
    ? compact.slice(PREFIX.length)
    : compact.startsWith("GR")
      ? compact.slice(2)
      : compact;
  if (!/^[A-Z0-9]{1,6}$/.test(body)) return null;
  return `${PREFIX}${body}`;
}
