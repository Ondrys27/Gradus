import { describe, expect, it } from "vitest";
import type { RateTable } from "@/lib/exchange-rates";
import { seedAddOns, seedPlanCatalog } from "./catalog-seed";
import {
  addOnPeriodPrice,
  addOnPrice,
  chargeCurrency,
  localizePlans,
  manualDeviation,
  MANUAL_DEVIATION_WARN,
  moneyIn,
} from "./localized";

const NOW = new Date("2026-11-09T12:00:00Z");
const fresh = new Date(NOW.getTime() - 86_400_000).toISOString();
const stale = new Date(NOW.getTime() - 8 * 86_400_000).toISOString();
const RATES: RateTable = {
  CZK: { rate: 24.3, at: fresh, source: "ecb" },
  USD: { rate: 1.16, at: fresh, source: "ecb" },
  GBP: { rate: 0.87, at: fresh, source: "ecb" },
  JPY: { rate: 157, at: fresh, source: "ecb" },
  PLN: { rate: 4.25, at: stale, source: "ecb" },
};

describe("plan prices in any currency", () => {
  it("keep a manual price whatever the rate", () => {
    const pro = seedPlanCatalog().find((plan) => plan.key === "pro")!;
    expect(moneyIn(pro.monthly, "CZK", { CZK: { rate: 99, at: fresh, source: "ecb" } }, NOW)).toEqual({
      amount: 890,
      origin: "manual",
    });
  });

  it("derive the others from EUR as a selling price, the year as the same months", () => {
    const prices = localizePlans(seedPlanCatalog(), "USD", RATES, NOW);
    expect(prices.currency).toBe("USD");
    expect(prices.derived).toBe(true);
    expect(prices.rateAt).toBe(fresh);
    const solo = prices.plans.find((plan) => plan.key === "solo")!;
    expect(solo.monthly.USD).toBe(21.99);
    expect(solo.yearly.USD).toBe(219.9);
    const team = prices.plans.find((plan) => plan.key === "team")!;
    expect(team.per_worker?.USD).toBeGreaterThan(0);
    const jpy = localizePlans(seedPlanCatalog(), "JPY", RATES, NOW).plans.find((plan) => plan.key === "solo")!;
    expect(jpy.monthly.JPY).toBe(2990);
    expect(jpy.yearly.JPY).toBe(29_900);
  });

  it("show EUR when the rate is missing or older than 7 days", () => {
    for (const currency of ["PLN", "INR"]) {
      const prices = localizePlans(seedPlanCatalog(), currency, RATES, NOW);
      expect(prices).toMatchObject({ currency: "EUR", wanted: currency, derived: false, rateAt: null });
    }
    // The manual CZK needs no rate at all.
    expect(localizePlans(seedPlanCatalog(), "CZK", {}, NOW)).toMatchObject({ currency: "CZK", derived: false });
  });

  it("charge only EUR or a manual currency", () => {
    const solo = seedPlanCatalog()[0];
    expect(chargeCurrency(solo, "CZK")).toBe("CZK");
    expect(chargeCurrency(solo, "USD")).toBe("EUR");
  });

  it("warn when a manual price is more than 15 % from the rate", () => {
    const money = { EUR: 19, CZK: 490 };
    expect(manualDeviation(money, "CZK", RATES, NOW)).toBeCloseTo(490 / (19 * 24.3) - 1, 6);
    expect(Math.abs(manualDeviation(money, "CZK", RATES, NOW)!)).toBeLessThan(MANUAL_DEVIATION_WARN);
    expect(manualDeviation({ EUR: 19, CZK: 590 }, "CZK", RATES, NOW)!).toBeGreaterThan(MANUAL_DEVIATION_WARN);
    expect(manualDeviation(money, "USD", RATES, NOW)).toBeNull();
    expect(manualDeviation(money, "CZK", {}, NOW)).toBeNull();
  });
});

describe("the add-on without branding", () => {
  it("costs 0,99 € and 29 Kč by hand, every other currency derived", () => {
    const [addOn] = seedAddOns();
    expect(addOn.key).toBe("no_branding");
    expect(addOnPrice(addOn, "EUR", RATES, NOW)).toEqual({ amount: 0.99, currency: "EUR", origin: "manual" });
    expect(addOnPrice(addOn, "CZK", RATES, NOW)).toEqual({ amount: 29, currency: "CZK", origin: "manual" });
    expect(addOnPrice(addOn, "GBP", RATES, NOW)).toEqual({ amount: 0.89, currency: "GBP", origin: "derived" });
    expect(addOnPrice(addOn, "USD", RATES, NOW)).toMatchObject({ currency: "USD", origin: "derived" });
    expect(addOnPrice(addOn, "PLN", RATES, NOW)).toEqual({ amount: 0.99, currency: "EUR", origin: "manual" });
    expect(addOnPeriodPrice(0.99, "yearly", "EUR")).toBe(11.88);
    expect(addOnPeriodPrice(29, "monthly", "CZK")).toBe(29);
  });
});
