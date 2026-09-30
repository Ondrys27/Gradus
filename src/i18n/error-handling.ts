import { IntlErrorCode, type IntlError } from "next-intl";

/**
 * How next-intl reacts to a missing or wrong key, shared by the server request
 * config and the client provider.
 *
 * Development: every problem is logged with `console.error`, which Next turns
 * into the error overlay, and the fallback shows the full key path so the spot
 * is obvious on screen. Production: nothing crashes or spams the console; the
 * fallback is a readable text made from the last key segment.
 */
const isDev = process.env.NODE_ENV !== "production";

export function onIntlError(error: IntlError) {
  if (isDev) {
    console.error(error);
    return;
  }
  // A bad key in production is a bug to fix, but not one to shout at users about.
  if (
    error.code !== IntlErrorCode.MISSING_MESSAGE &&
    error.code !== IntlErrorCode.INSUFFICIENT_PATH
  ) {
    console.error(error);
  }
}

/** `depositPaid` → "Deposit paid", `in_progress` → "In progress". */
export function humanizeKey(key: string): string {
  const last = key.split(".").pop() ?? key;
  const words = last
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

export function getIntlMessageFallback({
  namespace,
  key,
}: {
  namespace?: string;
  key: string;
  error: IntlError;
}): string {
  const path = namespace ? `${namespace}.${key}` : key;
  return isDev ? path : humanizeKey(path);
}
