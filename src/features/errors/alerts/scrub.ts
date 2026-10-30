import { scrubMessage } from "@/lib/analytics/scrub";

/**
 * What of an error may leave in an e-mail: technical text only, never the
 * content of someone's data. Shared by the browser (before sending) and the
 * server (again, because a browser can send anything).
 */

/** Frames of the stack an e-mail shows. */
export const STACK_LINES = 10;
const STACK_LINE_MAX = 300;
export const STACK_MAX = 4000;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** Strict, so a Firefox frame's "fn@https://…" is left alone. */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
/** Text in quotes with a space in it is a value someone typed (a name, a title), not an identifier. */
const QUOTED_TEXT = /(["'„“`])([^"'„“`\n]*\s[^"'„“`\n]*)(["'“”`])/g;
/** An amount with its currency: "1 500 Kč", "€ 12.50", "120 USD". */
const AMOUNT = /(?:(?:€|\$|£)\s?\d[\d\s.,]*)|(?:\d[\d\s.,]*\s?(?:Kč|CZK|EUR|USD|GBP|PLN|€|\$|£))/gi;
/**
 * A number written in groups, as a phone ("+420 777 123 456", "777-123-456")
 * or a date is: each group alone is too short for the long-number rule.
 */
const GROUPED_DIGITS = /\+?\d{1,4}(?:[ .\/-]\d{2,4}){2,}/g;

/**
 * An error's message as stored and e-mailed: the analytics scrub (e-mails and
 * numbers of 5+ digits out, 200 characters) plus quoted text, amounts and
 * numbers written in groups (phones) out.
 */
export function scrubErrorMessage(message: unknown): string {
  const text = typeof message === "string" ? message : String(message ?? "");
  return scrubMessage(
    text
      .replace(UUID, ":id")
      .replace(QUOTED_TEXT, "$1[text]$3")
      .replace(AMOUNT, "[amount]")
      .replace(GROUPED_DIGITS, "[n]"),
  );
}

/** "TypeError: x is not a function" of anything thrown. */
export function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  return "unknown";
}

/** Chrome/Node "at fn (file:1:2)", Firefox/Safari "fn@file:1:2". */
function isFrame(line: string): boolean {
  return /^at\s/.test(line) || /@.*:\d+(:\d+)?\)?$/.test(line) || /:\d+:\d+\)?$/.test(line);
}

/**
 * The first frames of a stack: only lines that are frames (the first line
 * repeats the message and is left out), without query strings, ids or
 * e-mails, each cut to 300 characters. Null when there is no frame.
 */
export function scrubStack(stack: unknown, lines = STACK_LINES): string | null {
  if (typeof stack !== "string" || !stack) return null;
  const frames = stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && isFrame(line))
    .slice(0, lines)
    .map((line) =>
      line
        .replace(/\?[^\s):]*/g, "")
        .replace(UUID, ":id")
        .replace(EMAIL, "[email]")
        .slice(0, STACK_LINE_MAX),
    );
  if (!frames.length) return null;
  return frames.join("\n").slice(0, STACK_MAX);
}
