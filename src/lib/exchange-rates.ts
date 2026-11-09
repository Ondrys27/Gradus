import { BASE_CURRENCY, currencyDigits, isCurrencyShape } from "./currency";

/**
 * Exchange rates (step 24.1), base EUR: how many units of a currency one euro
 * buys. They only ever change what is shown (plan prices, summaries across
 * currencies); a stored amount is never converted. The database keeps the
 * last rate of every currency (`exchange_rates`), the daily cron refreshes it
 * from the ECB (frankfurter.app) and open.er-api.com for the rest.
 */

/** A rate older than this is not used for a price: the price is shown in EUR instead. */
export const RATE_MAX_AGE_DAYS = 7;
const RATE_MAX_AGE_MS = RATE_MAX_AGE_DAYS * 86_400_000;

export type RateSource = "ecb" | "open_er";

/** One currency's rate and when it was fetched (ISO instant). */
export type Rate = { rate: number; at: string; source: RateSource };

/** Every known rate by currency code; EUR itself is implied (1). */
export type RateTable = Record<string, Rate>;

/** The rate of a currency if it is fresh enough to price with, else null. EUR is always 1. */
export function freshRate(table: RateTable, code: string, now: Date = new Date()): number | null {
  if (code === BASE_CURRENCY) return 1;
  const entry = table[code];
  if (!entry || !(entry.rate > 0)) return null;
  const age = now.getTime() - new Date(entry.at).getTime();
  return Number.isFinite(age) && age <= RATE_MAX_AGE_MS ? entry.rate : null;
}

/** When the rate of a currency was fetched (null for EUR or an unknown one). */
export function rateDate(table: RateTable, code: string): string | null {
  return code === BASE_CURRENCY ? null : (table[code]?.at ?? null);
}

/**
 * An amount from one currency in another at today's rates, rounded to the
 * decimals of the target; null when either rate is missing or stale. Only
 * for showing: never store the result.
 */
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  table: RateTable,
  now: Date = new Date(),
): number | null {
  if (from === to) return amount;
  const fromRate = freshRate(table, from, now);
  const toRate = freshRate(table, to, now);
  if (fromRate === null || toRate === null) return null;
  const factor = 10 ** currencyDigits(to);
  return Math.round(((amount / fromRate) * toRate) * factor) / factor;
}

/** The amounts of several currencies as one sum in `to`, with what could not be converted. */
export type ConvertedSum = {
  total: number;
  /** The oldest rate used ("roughly at the rate of <date>"); null when no rate was needed. */
  asOf: string | null;
  /** Currencies without a usable rate, left out of the total. */
  missing: string[];
};

export function sumInCurrency(
  amounts: readonly { currency: string; amount: number }[],
  to: string,
  table: RateTable,
  now: Date = new Date(),
): ConvertedSum {
  let total = 0;
  let asOf: string | null = null;
  const missing: string[] = [];
  for (const { currency, amount } of amounts) {
    const converted = convertAmount(amount, currency, to, table, now);
    if (converted === null) {
      if (!missing.includes(currency)) missing.push(currency);
      continue;
    }
    total += converted;
    if (currency === to) continue;
    for (const used of [rateDate(table, currency), rateDate(table, to)]) {
      if (used && (asOf === null || used < asOf)) asOf = used;
    }
  }
  const factor = 10 ** currencyDigits(to);
  return { total: Math.round(total * factor) / factor, asOf, missing };
}

// ---------------------------------------------------------------------------
// The two sources (both free, without a key)
// ---------------------------------------------------------------------------

export type FetchedRates = { source: RateSource; rates: Record<string, number> };

/** Only sane rates of three-letter codes, never EUR itself. */
function cleanRates(raw: unknown): Record<string, number> {
  const rates: Record<string, number> = {};
  if (typeof raw !== "object" || raw === null) return rates;
  for (const [code, value] of Object.entries(raw as Record<string, unknown>)) {
    if (code === BASE_CURRENCY || !isCurrencyShape(code)) continue;
    if (typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1e9) {
      rates[code] = value;
    }
  }
  return rates;
}

/** frankfurter.app `/latest?from=EUR`: `{ base: "EUR", rates: { USD: 1.08, … } }`, the ECB's ~30. */
export function parseFrankfurter(body: unknown): FetchedRates | null {
  if (typeof body !== "object" || body === null) return null;
  const { base, rates } = body as { base?: unknown; rates?: unknown };
  if (base !== BASE_CURRENCY) return null;
  const clean = cleanRates(rates);
  return Object.keys(clean).length ? { source: "ecb", rates: clean } : null;
}

/** open.er-api.com `/v6/latest/EUR`: `{ result: "success", base_code: "EUR", rates: {…} }`, ~160. */
export function parseOpenEr(body: unknown): FetchedRates | null {
  if (typeof body !== "object" || body === null) return null;
  const { result, base_code: base, rates } = body as {
    result?: unknown;
    base_code?: unknown;
    rates?: unknown;
  };
  if (result !== "success" || base !== BASE_CURRENCY) return null;
  const clean = cleanRates(rates);
  return Object.keys(clean).length ? { source: "open_er", rates: clean } : null;
}

/**
 * The rows to store from what the sources returned: the ECB's rate wherever
 * it has one, open.er-api.com for the rest. A source that failed (null) adds
 * nothing, so the last stored rate of its currencies stays as it was.
 */
export function mergeRates(
  fetched: readonly (FetchedRates | null)[],
  at: string,
): { code: string; rate: number; source: RateSource; fetched_at: string }[] {
  const order: RateSource[] = ["ecb", "open_er"];
  const rows = new Map<string, { code: string; rate: number; source: RateSource; fetched_at: string }>();
  for (const source of order) {
    const result = fetched.find((item) => item?.source === source);
    if (!result) continue;
    for (const [code, rate] of Object.entries(result.rates)) {
      if (!rows.has(code)) rows.set(code, { code, rate, source, fetched_at: at });
    }
  }
  return [...rows.values()].sort((a, b) => a.code.localeCompare(b.code));
}
