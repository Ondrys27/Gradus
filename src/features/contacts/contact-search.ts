/**
 * Search and duplicate matching. The database keeps `phone_normalized` as digits
 * only with the "00" prefix dropped (see `normalize_phone` in the migrations);
 * `normalizePhone` mirrors it so both sides agree.
 */

/** Most national numbers fit in nine digits; anything in front of them is the country prefix. */
export const NATIONAL_DIGITS = 9;
/** Fewer digits than this match too many numbers to be worth searching. */
const MIN_PHONE_DIGITS = 3;

export function normalizePhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "").replace(/^00/, "");
  return digits || null;
}

/** The last nine digits: "+420 777 123 456" and "777 123 456" are the same number. */
export function nationalPart(normalized: string): string {
  return normalized.slice(-NATIONAL_DIGITS);
}

/** Characters that mean something inside a PostgREST filter or a LIKE pattern. */
export function cleanTerm(term: string): string {
  return term
    .replace(/[%_,()*\\"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Country prefixes are one to three digits long. */
const MAX_PREFIX_DIGITS = 3;
/** A part of a number shorter than this is not searched without its prefix. */
const MIN_PART_DIGITS = 5;

/**
 * Digit sequences to look for in `phone_normalized` when the term reads like a
 * phone number (no letters). Spaces, dashes and the country prefix are ignored:
 * a full number is cut to its national part, and a partial one typed with "+"
 * or "00" is also tried without a prefix of each possible length, so it finds
 * numbers saved without one.
 */
export function phoneSearchDigits(term: string): string[] {
  if (/\p{L}/u.test(term)) return [];
  const digits = normalizePhone(term);
  if (!digits || digits.length < MIN_PHONE_DIGITS) return [];
  if (digits.length > NATIONAL_DIGITS) return [nationalPart(digits)];
  const patterns = [digits];
  if (/^\s*(\+|00)/.test(term)) {
    for (let cut = 1; cut <= MAX_PREFIX_DIGITS; cut++) {
      if (digits.length - cut >= MIN_PART_DIGITS) patterns.push(digits.slice(cut));
    }
  }
  return patterns;
}

/** PostgREST `or` filter for the list search, or null when the term is empty. */
export function searchFilter(term: string): string | null {
  const clean = cleanTerm(term);
  if (!clean) return null;
  const parts = [`search_name.ilike."%${clean}%"`, `email.ilike."%${clean}%"`];
  for (const digits of phoneSearchDigits(clean)) {
    parts.push(`phone_normalized.like."%${digits}%"`);
  }
  return parts.join(",");
}

/** Phone key for duplicate checks: only numbers long enough to be a real phone. */
export function duplicatePhoneKey(phone: string | null | undefined): string | null {
  const digits = normalizePhone(phone);
  if (!digits || digits.length < 6) return null;
  return nationalPart(digits);
}

/**
 * E-mail key for duplicate checks, compared case-insensitively. Characters that
 * would break the filter make it unusable; an "_" matching any character only
 * widens a warning, so it stays.
 */
export function duplicateEmailKey(email: string | null | undefined): string | null {
  const clean = (email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) || /[%,()*\\"]/.test(clean)) return null;
  return clean;
}

/** Value for a `tel:` link: keeps a leading plus and the digits. */
export function telHref(phone: string): string {
  const trimmed = phone.trim();
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${trimmed.replace(/\D/g, "")}`;
}
