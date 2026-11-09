import { BASE_CURRENCY, currencyForCountry, isCurrencyCode } from "@/lib/currency";
import { DEFAULT_COUNTRY } from "@/lib/region";

/**
 * Which currency the price list shows a visitor (step 24.1). In order: the
 * one they picked in the switcher (or `?mena=USD` in the address), the
 * signed-in user's own currency (the app keeps it in a cookie), the
 * currency of the country Vercel saw the request from (x-vercel-ip-country,
 * put in a cookie by the middleware), and else the page's: CZK on the Czech
 * site, EUR on the English one. No tracking: the cookies only hold a code.
 */

/** The signed-in user's currency from user_settings, written by the app. */
export const USER_CURRENCY_COOKIE = "gradus_currency";
/** The currency of the visitor's country, written by the middleware. */
export const GEO_CURRENCY_COOKIE = "gradus_geo_currency";
export const CURRENCY_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
/** The visitor's own pick in the switcher (this browser only). */
export const PICKED_CURRENCY_KEY = "gradus.web.currency";
/** `?mena=USD` (or `?currency=`) picks the currency through a link. */
export const CURRENCY_PARAMS = ["mena", "currency"] as const;

/** The page's own currency: the Czech site's country, else EUR. Also its SEO offers'. */
export function pageCurrency(locale: string): string {
  return locale === "cs" ? (currencyForCountry(DEFAULT_COUNTRY) ?? BASE_CURRENCY) : BASE_CURRENCY;
}

export type CurrencyHints = {
  param?: string | null;
  picked?: string | null;
  user?: string | null;
  geo?: string | null;
};

export function visitorCurrency(locale: string, hints: CurrencyHints): string {
  for (const candidate of [hints.param?.toUpperCase(), hints.picked, hints.user, hints.geo]) {
    if (isCurrencyCode(candidate)) return candidate;
  }
  return pageCurrency(locale);
}

/** The currency of the country Vercel saw, for the middleware's cookie; null when unknown. */
export function geoCurrency(countryHeader: string | null | undefined): string | null {
  if (!countryHeader || !/^[A-Za-z]{2}$/.test(countryHeader)) return null;
  return currencyForCountry(countryHeader);
}

/** One cookie of `document.cookie`, or null. */
export function readCookie(cookies: string, name: string): string | null {
  for (const part of cookies.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}
