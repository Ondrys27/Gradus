import { describe, expect, it } from "vitest";
import { MAX_DEVIATION, psychologicalPrice } from "./psychological-price";

/** Rates of one euro, roughly as in autumn 2026. */
const RATES = { CZK: 24.3, USD: 1.16, GBP: 0.87, PLN: 4.25, JPY: 157, INR: 98, BRL: 6.3, HUF: 395, KRW: 1500 };
const fromEur = (eur: number, currency: keyof typeof RATES) => psychologicalPrice(eur * RATES[currency], currency);

describe("psychologicalPrice", () => {
  it("prices EUR → CZK like the manual Czech prices", () => {
    expect(fromEur(19, "CZK")).toBe(490);
    expect(fromEur(35, "CZK")).toBe(890);
    expect(fromEur(12, "CZK")).toBe(290);
    // 0,99 € is 24,06 Kč: 19 and 29 are both 20 % away, so x,99 (the add-on's 29 Kč is a manual price).
    expect(fromEur(0.99, "CZK")).toBe(23.99);
    const yearly = fromEur(190, "CZK");
    expect(yearly % 100).toBe(90);
  });

  it("follows the rules by size for currencies with decimals", () => {
    expect(fromEur(0.99, "USD")).toBe(1.19);
    expect(fromEur(0.99, "GBP")).toBe(0.89);
    expect(fromEur(0.99, "PLN")).toBe(3.99);
    expect(fromEur(19, "USD")).toBe(21.99);
    expect(fromEur(35, "USD")).toBe(39);
    expect(fromEur(35, "GBP")).toBe(29);
    expect(fromEur(19, "PLN")).toBe(79);
    expect(fromEur(19, "BRL")).toBe(119);
    expect(fromEur(19, "INR")).toBe(1890);
    expect(psychologicalPrice(48_210, "USD")).toBe(47_900);
  });

  it("writes currencies without decimals as whole selling prices", () => {
    expect(fromEur(19, "JPY")).toBe(2990);
    expect(fromEur(0.99, "JPY")).toBe(159);
    expect(fromEur(19, "KRW")).toBe(28_900);
    expect(fromEur(19, "HUF")).toBe(7490);
    expect(Number.isInteger(fromEur(0.99, "HUF"))).toBe(true);
    expect(psychologicalPrice(13.4, "JPY")).toBe(13);
  });

  it("never moves more than 8 % from the exact conversion", () => {
    for (const currency of ["EUR", "USD", "CZK", "JPY", "KWD", "HUF"]) {
      // From a fifth of a unit, or seven whole units where there are no decimals.
      const from = ["JPY", "HUF"].includes(currency) ? 7 : 0.2;
      for (let amount = from; amount < 2_000_000; amount *= 1.037) {
        const price = psychologicalPrice(amount, currency);
        expect(price).toBeGreaterThan(0);
        expect(Math.abs(price - amount) / amount).toBeLessThanOrEqual(MAX_DEVIATION + 1e-9);
      }
    }
  });

  it("gives nothing for nothing", () => {
    expect(psychologicalPrice(0, "EUR")).toBe(0);
    expect(psychologicalPrice(Number.NaN, "EUR")).toBe(0);
  });
});
