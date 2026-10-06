import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { getIntlMessageFallback, onIntlError } from "./error-handling";
import { LOCALE_COOKIE, URL_LOCALE_HEADER } from "./locale-cookie";
import { defaultLocale, locales, type Locale } from "./locales";

function asLocale(value: string | null | undefined): Locale | null {
  return locales.includes(value as Locale) ? (value as Locale) : null;
}

/**
 * The public website's root layouts set the language with `setRequestLocale`
 * (from the address); that keeps them static. Everything else reads it per
 * request: the sign-in pages from the address (the middleware's header), the
 * app from the account's language, kept in the cookie.
 */
async function localeOfRequest(): Promise<Locale> {
  const [headerList, cookieStore] = await Promise.all([headers(), cookies()]);
  return (
    asLocale(headerList.get(URL_LOCALE_HEADER)) ??
    asLocale(cookieStore.get(LOCALE_COOKIE)?.value) ??
    defaultLocale
  );
}

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = asLocale(await requestLocale) ?? (await localeOfRequest());

  return {
    locale,
    messages: (await import(`../locales/${locale}.json`)).default,
    onError: onIntlError,
    getMessageFallback: getIntlMessageFallback,
  };
});
