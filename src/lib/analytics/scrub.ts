import { SCRUBBED_MAX } from "./fields";

const EMAIL_LIKE = /[^\s@<>()"',;:]*@[^\s@<>()"',;:]*/g;
const LONG_NUMBER = /\d{5,}/g;

/**
 * Makes an error message safe to store: anything that looks like an e-mail
 * goes, numbers longer than 4 digits go (phones, ids, amounts), whitespace is
 * collapsed and the result is cut to 200 characters.
 */
export function scrubMessage(message: unknown): string {
  const text = typeof message === "string" ? message : String(message ?? "");
  const scrubbed = text
    .replace(EMAIL_LIKE, "[email]")
    .replace(LONG_NUMBER, "[n]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SCRUBBED_MAX)
    .trim();
  return scrubbed || "unknown";
}
