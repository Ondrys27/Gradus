import { describe, expect, it } from "vitest";
import { CURRENCY_LIST } from "@/config/currencies";
import {
  currencyDigits,
  currencyDisplayName,
  currencyForCountry,
  currencyMatches,
  isCurrencyCode,
  orderedCurrencies,
} from "./currency";
import { formatCurrency, formatPrice, DEFAULT_FORMAT_SETTINGS, NUMBER_FORMATS } from "./format";

const EN = { ...DEFAULT_FORMAT_SETTINGS, numberLocale: NUMBER_FORMATS.en };
const plain = (value: string) => value.replace(/[  ]/g, " ");

describe("the currency list", () => {
  it("holds every currency in circulation once, without withdrawn codes", () => {
    const codes = CURRENCY_LIST.map((item) => item.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.length).toBeGreaterThan(140);
    for (const code of ["EUR", "USD", "CZK", "JPY", "INR", "BRL", "KWD"]) expect(isCurrencyCode(code)).toBe(true);
    for (const code of ["HRK", "BGN", "XAU", "XDR", "eur", "", null]) expect(isCurrencyCode(code)).toBe(false);
    for (const item of CURRENCY_LIST) {
      expect(item.name.cs.length).toBeGreaterThan(0);
      expect(item.name.en.length).toBeGreaterThan(0);
    }
  });

  it("knows the decimals money is written with", () => {
    expect(currencyDigits("CZK")).toBe(2);
    expect(currencyDigits("JPY")).toBe(0);
    expect(currencyDigits("KRW")).toBe(0);
    expect(currencyDigits("HUF")).toBe(0);
    expect(currencyDigits("KWD")).toBe(3);
    expect(currencyDigits("XYZ")).toBe(2);
  });

  it("finds the currency of a country", () => {
    expect(currencyForCountry("CZ")).toBe("CZK");
    expect(currencyForCountry("sk")).toBe("EUR");
    expect(currencyForCountry("JP")).toBe("JPY");
    expect(currencyForCountry("BG")).toBe("EUR");
    expect(currencyForCountry("ZZ")).toBeNull();
    expect(currencyForCountry(null)).toBeNull();
  });
});

describe("the currency picker", () => {
  it("puts the country's currency first, then the popular ones, then the rest A–Z", () => {
    const { popular, rest } = orderedCurrencies("JP");
    expect(popular[0]).toBe("JPY");
    expect(popular.slice(1, 4)).toEqual(["EUR", "USD", "GBP"]);
    expect(new Set(popular).size).toBe(popular.length);
    expect(rest).not.toContain("JPY");
    expect([...rest].sort()).toEqual(rest);
    expect(popular.length + rest.length).toBe(CURRENCY_LIST.length);
    // A stored code no longer in circulation stays pickable.
    expect(orderedCurrencies("CZ", "BGN").rest).toContain("BGN");
  });

  it("searches by code and by name in either language, without diacritics", () => {
    expect(currencyMatches("JPY", "jp", "cs")).toBe(true);
    expect(currencyMatches("JPY", "jen", "cs")).toBe(true);
    expect(currencyMatches("JPY", "yen", "cs")).toBe(true);
    expect(currencyMatches("CZK", "koruna", "en")).toBe(true);
    expect(currencyMatches("CZK", "ceska", "en")).toBe(true);
    expect(currencyMatches("CZK", "dollar", "en")).toBe(false);
    expect(currencyMatches("USD", "", "en")).toBe(true);
    expect(currencyDisplayName("EUR", "cs")).toBe("euro");
  });
});

describe("formatting money in any currency", () => {
  it("never writes more decimals than a currency has", () => {
    expect(plain(formatCurrency(2990, "JPY", EN, 2))).toBe("¥2,990");
    expect(plain(formatCurrency(1234.5, "KRW", DEFAULT_FORMAT_SETTINGS, 2))).toBe("1 235 ₩");
    expect(plain(formatCurrency(19.9, "EUR", DEFAULT_FORMAT_SETTINGS, 2))).toBe("19,90 €");
  });

  it("writes a price whole when it is whole, else with the currency's decimals", () => {
    expect(plain(formatPrice(490, "CZK"))).toBe("490 Kč");
    expect(plain(formatPrice(0.99, "EUR"))).toBe("0,99 €");
    expect(plain(formatPrice(1.19, "USD", EN))).toBe("$1.19");
    expect(plain(formatPrice(2990, "JPY", EN))).toBe("¥2,990");
  });
});
