import { createHash } from "node:crypto";

/**
 * "The same error": the same message at the same place. The message loses
 * what changes between two occurrences of one bug (numbers, ids, letter
 * case, spacing, built file names and hashes; typed values are already out after scrubErrorMessage); the
 * place is the page (ids already taken out), how the error was caught and the
 * action (the route, the cron job). The result is 32 hex characters of a
 * SHA-256.
 */
export function normalizeForFingerprint(message: string): string {
  return message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ":id")
    // Built files and their hashes change with every deployment (a chunk that
    // failed to load after a release), so they would start a new group each time.
    .replace(/\S*\/_next\/\S+/g, ":asset")
    .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/g, ":hash")
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
