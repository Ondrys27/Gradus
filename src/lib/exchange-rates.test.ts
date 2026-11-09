import { describe, expect, it } from "vitest";
import {
  convertAmount,
  freshRate,
  mergeRates,
  parseFrankfurter,
  parseOpenEr,
  sumInCurrency,
  type RateTable,
} from "./exchange-rates";

const NOW = new Date("2026-11-09T12:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

const RATES: RateTable = {
  CZK: { rate: 24.3, at: ago(1), source: "ecb" },
  USD: { rate: 1.16, at: ago(1), source: "ecb" },
  JPY: { rate: 157, at: ago(2), source: "ecb" },
  ARS: { rate: 1200, at: ago(8), source: "open_er" },
};

describe("freshRate", () => {
  it("gives EUR as 1, a rate up to 7 days old, and nothing older or unknown", () => {
    expect(freshRate(RATES, "EUR", NOW)).toBe(1);
    expect(freshRate(RATES, "CZK", NOW)).toBe(24.3);
    expect(freshRate({ CZK: { rate: 24.3, at: ago(7), source: "ecb" } }, "CZK", NOW)).toBe(24.3);
    expect(freshRate(RATES, "ARS", NOW)).toBeNull();
    expect(freshRate(RATES, "GBP", NOW)).toBeNull();
  });
});

describe("convertAmount", () => {
  it("goes through EUR and rounds to the target's decimals", () => {
    expect(convertAmount(100, "EUR", "CZK", RATES, NOW)).toBe(2430);
    expect(convertAmount(2430, "CZK", "EUR", RATES, NOW)).toBe(100);
    expect(convertAmount(100, "USD", "JPY", RATES, NOW)).toBe(13534);
    expect(convertAmount(5, "CZK", "CZK", RATES, NOW)).toBe(5);
  });

  it("refuses to guess without a fresh rate", () => {
    expect(convertAmount(100, "ARS", "EUR", RATES, NOW)).toBeNull();
    expect(convertAmount(100, "EUR", "GBP", RATES, NOW)).toBeNull();
  });
});

describe("sumInCurrency", () => {
  it("adds amounts of several currencies, says the oldest rate and leaves out what it cannot convert", () => {
    const sum = sumInCurrency(
      [
        { currency: "CZK", amount: 1000 },
        { currency: "EUR", amount: 10 },
        { currency: "JPY", amount: 15_700 },
        { currency: "ARS", amount: 5000 },
      ],
      "CZK",
      RATES,
      NOW,
    );
    expect(sum.total).toBe(1000 + 243 + 2430);
    expect(sum.asOf).toBe(ago(2));
    expect(sum.missing).toEqual(["ARS"]);
  });

  it("needs no rate for one currency", () => {
    expect(sumInCurrency([{ currency: "CZK", amount: 5 }], "CZK", {}, NOW)).toEqual({
      total: 5,
      asOf: null,
      missing: [],
    });
  });
});

describe("the sources", () => {
  it("read frankfurter.app and open.er-api.com, only sane rates of three-letter codes", () => {
    expect(parseFrankfurter({ base: "EUR", rates: { USD: 1.16, CZK: 24.3, EUR: 1, bad: 3, GBP: -1 } })).toEqual({
      source: "ecb",
      rates: { USD: 1.16, CZK: 24.3 },
    });
    expect(parseFrankfurter({ base: "USD", rates: { CZK: 21 } })).toBeNull();
    expect(parseFrankfurter("<html>")).toBeNull();
    expect(parseOpenEr({ result: "success", base_code: "EUR", rates: { ARS: 1200, CZK: 24.4 } })).toEqual({
      source: "open_er",
      rates: { ARS: 1200, CZK: 24.4 },
    });
    expect(parseOpenEr({ result: "error", "error-type": "quota" })).toBeNull();
  });

  it("prefers the ECB and keeps the last rate of a source that failed", () => {
    const at = NOW.toISOString();
    const both = mergeRates(
      [
        { source: "open_er", rates: { ARS: 1200, CZK: 24.4 } },
        { source: "ecb", rates: { CZK: 24.3 } },
      ],
      at,
    );
    expect(both).toEqual([
      { code: "ARS", rate: 1200, source: "open_er", fetched_at: at },
      { code: "CZK", rate: 24.3, source: "ecb", fetched_at: at },
    ]);
    // The ECB failed: only open.er-api.com's rows; nothing else is touched.
    expect(mergeRates([null, { source: "open_er", rates: { ARS: 1200 } }], at)).toEqual([
      { code: "ARS", rate: 1200, source: "open_er", fetched_at: at },
    ]);
    expect(mergeRates([null, null], at)).toEqual([]);
  });
});
