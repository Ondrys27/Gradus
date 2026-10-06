import { locales, type Locale } from "./locales";

export const LOCALE_COOKIE = "locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
/**
 * Set by the middleware on the public site and the sign-in pages, whose
 * language comes from the address (/en/...), not from the cookie.
 */
export const URL_LOCALE_HEADER = "x-gradus-url-locale";

/** Client side: the next-intl request config reads this cookie on every render. */
export function writeLocaleCookie(locale: Locale) {
  if (!locales.includes(locale)) return;
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
}
