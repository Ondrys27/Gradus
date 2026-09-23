import { locales, type Locale } from "./locales";

/** Client side: the next-intl request config reads this cookie on every render. */
export function writeLocaleCookie(locale: Locale) {
  if (!locales.includes(locale)) return;
  document.cookie = `locale=${locale}; path=/; max-age=31536000; samesite=lax`;
}
