import { COUNTRY_CURRENCY, CURRENCY_LIST, type CurrencyInfo } from "@/config/currencies";

/**
 * Currencies of the world (step 24.1): the generated list in
 * src/config/currencies.ts and what the app asks of it. Formatting stays in
 * src/lib/format.ts, which reads the decimals from here.
 */

/** The currency plan prices are set in and every other price is derived from. */
export const BASE_CURRENCY = "EUR";

const BY_CODE = new Map(CURRENCY_LIST.map((item) => [item.code, item]));

/** Every code in circulation, A–Z. */
export const CURRENCY_CODES: readonly string[] = CURRENCY_LIST.map((item) => item.code);

/** A currency in circulation (not just three letters). */
export function isCurrencyCode(value: unknown): value is string {
  return typeof value === "string" && BY_CODE.has(value);
}

/** Three capital letters, as the database stores a currency. */
export function isCurrencyShape(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

export function currencyInfo(code: string): CurrencyInfo | null {
  return BY_CODE.get(code) ?? null;
}

/**
 * Decimals an amount of the currency is written with: 0 for JPY, HUF, KRW…,
 * 3 for KWD, BHD…, 2 otherwise (and for codes outside the list).
 */
export function currencyDigits(code: string): number {
  return BY_CODE.get(code)?.digits ?? 2;
}

/** The currency of a country (ISO 3166-1 alpha-2), or null for an unknown one. */
export function currencyForCountry(country: string | null | undefined): string | null {
  if (!country) return null;
  return COUNTRY_CURRENCY[country.toUpperCase()] ?? null;
}

/** Picked most often, after the user's own country's currency. */
export const POPULAR_CURRENCIES = [
  "EUR",
  "USD",
  "GBP",
  "CZK",
  "PLN",
  "CHF",
  "HUF",
  "SEK",
  "NOK",
  "DKK",
  "CAD",
  "AUD",
  "JPY",
  "CNY",
  "INR",
  "BRL",
] as const;

/**
 * The order of a currency picker: the country's currency, the popular ones,
 * then the rest A–Z. `extra` keeps a stored code that is no longer in
 * circulation (BGN, HRK…) so the picker still shows it.
 */
export function orderedCurrencies(
  country: string | null | undefined,
  extra?: string | null,
): { popular: string[]; rest: string[] } {
  const own = currencyForCountry(country);
  const popular = [...new Set([own, ...POPULAR_CURRENCIES].filter((code): code is string => !!code))];
  const rest = CURRENCY_CODES.filter((code) => !popular.includes(code));
  if (extra && isCurrencyShape(extra) && !popular.includes(extra) && !rest.includes(extra)) {
    rest.push(extra);
  }
  return { popular, rest };
}

/** The name in the app's language (generated), else from the runtime. */
export function currencyDisplayName(code: string, uiLocale: string): string {
  const info = BY_CODE.get(code);
  if (info && (uiLocale === "cs" || uiLocale === "en")) return info.name[uiLocale];
  try {
    return new Intl.DisplayNames([uiLocale], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

/**
 * Whether a currency matches what the user typed: the code ("jp", "JPY") or
 * any word of its name in either language, without diacritics ("koruna",
 * "yen", "jen").
 */
export function currencyMatches(code: string, query: string, uiLocale: string): boolean {
  const q = fold(query);
  if (!q) return true;
  if (code.toLowerCase().startsWith(q)) return true;
  const info = BY_CODE.get(code);
  const names = [currencyDisplayName(code, uiLocale), ...(info ? [info.name.cs, info.name.en] : [])];
  return names.some((name) => {
    const folded = fold(name);
    return folded.startsWith(q) || folded.split(/[\s-]+/).some((word) => word.startsWith(q));
  });
}
