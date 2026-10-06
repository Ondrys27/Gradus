import { describe, expect, it } from "vitest";
import {
  monthlyPrice,
  PAID_PLANS,
  perWorkerPrice,
  priceCurrencyFor,
  yearlyPrice,
} from "./pricing";

const plan = (key: string) => PAID_PLANS.find((p) => p.key === key)!;

describe("pricing", () => {
  it("has the three plans with Pro recommended", () => {
    expect(PAID_PLANS.map((p) => p.key)).toEqual(["solo", "pro", "team"]);
    expect(PAID_PLANS.filter((p) => p.recommended).map((p) => p.key)).toEqual(["pro"]);
  });

  it("charges ten months for a year", () => {
    expect(yearlyPrice(plan("solo"), "CZK")).toBe(4900);
    expect(monthlyPrice(plan("pro"), "EUR", "monthly")).toBe(35);
    expect(monthlyPrice(plan("pro"), "CZK", "yearly")).toBe(742);
  });

  it("adds workers only to Team", () => {
    expect(perWorkerPrice(plan("team"), "CZK", "monthly")).toBe(290);
    expect(perWorkerPrice(plan("team"), "EUR", "monthly")).toBe(12);
    expect(perWorkerPrice(plan("pro"), "CZK", "monthly")).toBeNull();
  });

  it("shows CZK to Czech visitors and EUR to everyone else", () => {
    expect(priceCurrencyFor("cs")).toBe("CZK");
    expect(priceCurrencyFor("CZK")).toBe("CZK");
    expect(priceCurrencyFor("en")).toBe("EUR");
    expect(priceCurrencyFor("USD")).toBe("EUR");
  });
});
