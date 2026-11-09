import { HANDLE_MAX, HANDLE_MIN } from "./types";

/**
 * Handles (/s/<handle>) and slugs (/s/<handle>/<slug>) of the public booking
 * page. The same rule as scheduler_handle_ok() in the database: a–z, 0–9 and
 * single hyphens inside, 3–30 characters, a few words reserved.
 */

export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "app",
  "gradus",
  "help",
  "login",
  "www",
  "support",
  "static",
  "public",
  "settings",
  "booking",
  "bookings",
  "scheduler",
  "cancel",
  "manage",
]);

const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
export const SLUG_MAX = 60;

/** Lower case, no diacritics, everything else a single hyphen, none at the ends. */
export function slugify(text: string, max: number): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

export type HandleProblem = "tooShort" | "tooLong" | "format" | "reserved";

export function handleProblem(handle: string): HandleProblem | null {
  if (handle.length < HANDLE_MIN) return "tooShort";
  if (handle.length > HANDLE_MAX) return "tooLong";
  if (!HANDLE_PATTERN.test(handle) || handle.includes("--")) return "format";
  if (RESERVED_HANDLES.has(handle)) return "reserved";
  return null;
}

export function isValidHandle(handle: string): boolean {
  return handleProblem(handle) === null;
}

/** What a person types, made a handle as far as it goes (lower case, hyphens). */
export function normalizeHandleInput(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .slice(0, HANDLE_MAX);
}

/**
 * The first handle to try for a name ("Ondřej Otava" → "ondrej-otava"); too
 * short or reserved names get a neutral word in front.
 */
export function handleFromName(name: string | null | undefined): string {
  const base = slugify(name ?? "", HANDLE_MAX);
  if (isValidHandle(base)) return base;
  const padded = slugify(`meet-${base}`, HANDLE_MAX);
  return isValidHandle(padded) ? padded : "meet";
}

/** Candidates in order: the handle, then -2, -3 …, every one within 30 characters. */
export function handleCandidates(base: string, count = 20): string[] {
  const out: string[] = [];
  const clean = isValidHandle(base) ? base : handleFromName(base);
  if (isValidHandle(clean)) out.push(clean);
  for (let n = 2; out.length < count; n++) {
    const suffix = `-${n}`;
    const head = clean.slice(0, HANDLE_MAX - suffix.length).replace(/-+$/g, "");
    const candidate = `${head}${suffix}`;
    if (isValidHandle(candidate)) out.push(candidate);
    if (n > count + 5) break;
  }
  return out;
}

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !slug.includes("--");
}

/** A slug for a meeting type's name, unique among the person's others. */
export function uniqueSlug(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugify(name, SLUG_MAX) || "meeting";
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base.slice(0, SLUG_MAX - 9)}-${Date.now().toString(36).slice(-8)}`;
}

/** The public booking address of a person, or of one of their meeting types. */
export function bookingPath(handle: string, slug?: string): string {
  return slug ? `/s/${handle}/${slug}` : `/s/${handle}`;
}

export function bookingUrl(origin: string, handle: string, slug?: string): string {
  return `${origin.replace(/\/+$/, "")}${bookingPath(handle, slug)}`;
}
