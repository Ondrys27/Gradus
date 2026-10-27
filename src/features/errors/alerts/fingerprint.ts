import { createHash } from "node:crypto";

/**
 * "The same error": the same message at the same place. The message loses
 * what changes between two occurrences of one bug (numbers, ids, letter
 * case, spacing; typed values are already out after scrubErrorMessage); the
 * place is the page (ids already taken out), how the error was caught and the
 * action (the route, the cron job). The result is 32 hex characters of a
 * SHA-256.
 */
export function normalizeForFingerprint(message: string): string {
  return message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ":id")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

export function errorFingerprint(input: {
  message: string;
  page: string;
  /** How it was caught: boundary, onerror, render, route, action, cron… */
  source: string;
  action?: string | null;
}): string {
  const place = `${input.page}|${input.source}|${input.action ?? ""}`;
  return createHash("sha256")
    .update(`${normalizeForFingerprint(input.message)}\n${place}`)
    .digest("hex")
    .slice(0, 32);
}
