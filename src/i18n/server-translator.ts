import "server-only";
import { createTranslator } from "next-intl";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";
import { getIntlMessageFallback, onIntlError } from "./error-handling";
import { defaultLocale, locales, type Locale } from "./locales";

const MESSAGES = { en, cs } as const;

export function toLocale(value: string | null | undefined): Locale {
  return locales.includes(value as Locale) ? (value as Locale) : defaultLocale;
}

/**
 * Texts for things the server writes outside a page (e-mails), in the
 * recipient's language rather than the request's.
 */
export function serverTranslator(locale: string | null | undefined) {
  const resolved = toLocale(locale);
  return createTranslator({
    locale: resolved,
    messages: MESSAGES[resolved] as typeof en,
    onError: onIntlError,
    getMessageFallback: getIntlMessageFallback,
  });
}
