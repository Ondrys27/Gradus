import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";
import {
  mergeRates,
  parseFrankfurter,
  parseOpenEr,
  RATE_MAX_AGE_DAYS,
  type FetchedRates,
  type RateSource,
  type RateTable,
} from "@/lib/exchange-rates";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Exchange rates on the server (step 24.1). The table is closed to clients:
 * the server reads it here (cached for an hour, revalidated by the cron) and
 * hands the rates to the page or to GET /api/exchange-rates.
 */

export const EXCHANGE_RATES_TAG = "exchange-rates";

/** The two free sources, without a key; ECB first. */
export const RATE_SOURCES: Record<RateSource, { url: string; parse: (body: unknown) => FetchedRates | null }> = {
  ecb: { url: "https://api.frankfurter.app/latest?from=EUR", parse: parseFrankfurter },
  open_er: { url: "https://open.er-api.com/v6/latest/EUR", parse: parseOpenEr },
};
const TIMEOUT_MS = 10_000;

const loadRates = unstable_cache(
  async (): Promise<RateTable> => {
    const { data, error } = await createAdminClient()
      .from("exchange_rates")
      .select("code, rate, fetched_at, source")
      .eq("base", "EUR")
      .limit(400);
    if (error) throw new Error(`exchange rates: ${error.message}`);
    const table: RateTable = {};
    for (const row of data ?? []) {
      table[row.code] = { rate: Number(row.rate), at: row.fetched_at, source: row.source as RateSource };
    }
    return table;
  },
  ["exchange-rates"],
  { tags: [EXCHANGE_RATES_TAG], revalidate: 3600 },
);

/**
 * Every stored rate. On a database failure an empty table: prices then show
 * in EUR or in their manual currency, never a guess.
 */
export async function getExchangeRates(): Promise<RateTable> {
  try {
    return await loadRates();
  } catch (error) {
    console.error("[rates] exchange rates unavailable", error);
    return {};
  }
}

type SourceResult = { source: RateSource; fetched: FetchedRates | null; error: string | null };

async function fetchSource(source: RateSource, fetchImpl: typeof fetch): Promise<SourceResult> {
  const { url, parse } = RATE_SOURCES[source];
  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return { source, fetched: null, error: `http_${response.status}` };
    const fetched = parse(await response.json());
    return { source, fetched, error: fetched ? null : "invalid" };
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { source, fetched: null, error: timeout ? "timeout" : "network" };
  }
}

export type RefreshSummary = {
  stored: number;
  sources: Record<RateSource, { ok: boolean; rates: number; error: string | null }>;
};

/**
 * The daily refresh: asks both sources, stores the ECB's rate wherever it has
 * one and open.er-api.com's for the rest, and records how each source did.
 * A failed source changes none of its rates (the last ones stay); only when
 * both fail does the run fail, so the cron log and Health show it.
 */
export async function refreshExchangeRates(
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<RefreshSummary> {
  const at = now.toISOString();
  const results = await Promise.all(
    (Object.keys(RATE_SOURCES) as RateSource[]).map((source) => fetchSource(source, fetchImpl)),
  );
  const rows = mergeRates(
    results.map((result) => result.fetched),
    at,
  );
  const admin = createAdminClient();
  if (rows.length) {
    const { error } = await admin
      .from("exchange_rates")
      .upsert(rows.map((row) => ({ ...row, base: "EUR" })), { onConflict: "base,code" });
    if (error) throw new Error(`exchange rates: ${error.message}`);
  }
  const sources = {} as RefreshSummary["sources"];
  for (const result of results) {
    const stored = rows.filter((row) => row.source === result.source).length;
    sources[result.source] = { ok: !result.error, rates: stored, error: result.error };
    const { error } = await admin.from("exchange_rate_sources").upsert(
      {
        source: result.source,
        last_attempt_at: at,
        last_error: result.error,
        ...(result.error ? {} : { last_success_at: at, rates: stored }),
      },
      { onConflict: "source" },
    );
    if (error) throw new Error(`exchange rate sources: ${error.message}`);
  }
  revalidateTag(EXCHANGE_RATES_TAG);
  if (results.every((result) => result.error)) {
    throw new Error(`exchange rates: every source failed (${results.map((r) => r.error).join(", ")})`);
  }
  return { stored: rows.length, sources };
}

export type RateHealth = {
  sources: {
    source: RateSource;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    rates: number;
  }[];
  /** Currencies with a stored rate, and of them older than RATE_MAX_AGE_DAYS (shown in EUR). */
  currencies: number;
  stale: string[];
  oldestAt: string | null;
};

/** For Administration → Health: how each source did and which rates are too old to price with. */
export async function exchangeRateHealth(now: Date = new Date()): Promise<RateHealth> {
  const admin = createAdminClient();
  const [sources, rates] = await Promise.all([
    admin.from("exchange_rate_sources").select("source, last_attempt_at, last_success_at, last_error, rates"),
    admin.from("exchange_rates").select("code, fetched_at").eq("base", "EUR").limit(400),
  ]);
  if (sources.error) throw new Error(sources.error.message);
  if (rates.error) throw new Error(rates.error.message);
  const limit = now.getTime() - RATE_MAX_AGE_DAYS * 86_400_000;
  const rows = rates.data ?? [];
  return {
    sources: (Object.keys(RATE_SOURCES) as RateSource[]).map((source) => {
      const row = sources.data?.find((item) => item.source === source);
      return {
        source,
        lastAttemptAt: row?.last_attempt_at ?? null,
        lastSuccessAt: row?.last_success_at ?? null,
        lastError: row?.last_error ?? null,
        rates: row?.rates ?? 0,
      };
    }),
    currencies: rows.length,
    stale: rows
      .filter((row) => new Date(row.fetched_at).getTime() < limit)
      .map((row) => row.code)
      .sort(),
    oldestAt: rows.reduce<string | null>(
      (oldest, row) => (oldest === null || row.fetched_at < oldest ? row.fetched_at : oldest),
      null,
    ),
  };
}
