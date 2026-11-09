/**
 * The language and time zone of the public booking page (24.4). Only these
 * two are ever remembered, each in its own cookie the page sets itself when
 * the guest picks one; nothing else is stored on the guest's device.
 *
 * Language: the guest's own pick → the first Czech or English language the
 * browser asks for (Accept-Language, by weight) → the host's language → English.
 * Phase 25 adds more languages to BOOKING_LOCALES.
 */

export const BOOKING_LOCALES = ["cs", "en"] as const;
export type BookingLocale = (typeof BOOKING_LOCALES)[number];

export const BOOKING_LOCALE_COOKIE = "gradus_booking_locale";
export const BOOKING_ZONE_COOKIE = "gradus_booking_tz";
export const BOOKING_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isBookingLocale(value: unknown): value is BookingLocale {
  return typeof value === "string" && (BOOKING_LOCALES as readonly string[]).includes(value);
}

/** The languages of an Accept-Language header, most wanted first ("cs-CZ" counts as "cs"). */
export function acceptedLanguages(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return {
        lang: (tag ?? "").trim().toLowerCase().split("-")[0] ?? "",
        weight: Number.isFinite(weight) ? weight : 0,
        index,
      };
    })
    .filter((item) => item.lang && item.lang !== "*" && item.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .map((item) => item.lang);
}

export function bookingLocale(input: {
  chosen?: string | null;
  acceptLanguage?: string | null;
  hostLocale?: string | null;
}): BookingLocale {
  if (isBookingLocale(input.chosen)) return input.chosen;
  const browser = acceptedLanguages(input.acceptLanguage).find(isBookingLocale);
  if (browser) return browser;
  if (isBookingLocale(input.hostLocale)) return input.hostLocale;
  return "en";
}

/** A cookie the page writes for itself (language or zone), a year long. */
export function bookingCookie(name: string, value: string): string {
  return `${name}=${encodeURIComponent(value)}; path=/s; max-age=${BOOKING_COOKIE_MAX_AGE}; samesite=lax`;
}

/** One cookie's value from document.cookie. */
export function readCookie(cookies: string, name: string): string | null {
  for (const part of cookies.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}
