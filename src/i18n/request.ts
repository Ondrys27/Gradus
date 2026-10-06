import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { getIntlMessageFallback, onIntlError } from "./error-handling";
import { LOCALE_COOKIE, URL_LOCALE_HEADER } from "./locale-cookie";
import { defaultLocale, locales, type Locale } from "./locales";

function asLocale(value: string | null | undefined): Locale | null {
  return locales.includes(value as Locale) ? (value as Locale) : null;
}

export default getRequestConfig(async () => {
  // The public site and the sign-in pages carry their language in the address;
  // the app uses the account's language, kept in the cookie.
  const [headerList, cookieStore] = await Promise.all([headers(), cookies()]);
  const locale: Locale =
    asLocale(headerList.get(URL_LOCALE_HEADER)) ??
    asLocale(cookieStore.get(LOCALE_COOKIE)?.value) ??
    defaultLocale;

  return {
    locale,
    messages: (await import(`../locales/${locale}.json`)).default,
    onError: onIntlError,
    getMessageFallback: getIntlMessageFallback,
  };
});
