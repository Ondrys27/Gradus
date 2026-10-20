import { describe, expect, it } from "vitest";
import { catalogLocaleFor, isPaidPlanKey, PAID_PLANS, priceCurrencyFor } from "./pricing";

describe("pricing seed", () => {
  it("has the three plans with Pro recommended", () => {
    expect(PAID_PLANS.map((p) => p.key)).toEqual(["solo", "pro", "team"]);
    expect(PAID_PLANS.filter((p) => p.recommended).map((p) => p.key)).toEqual(["pro"]);
  });

  it("adds workers only to Team and leaves workers and storage without a limit", () => {
    expect(PAID_PLANS.filter((p) => p.perWorker).map((p) => p.key)).toEqual(["team"]);
    for (const plan of PAID_PLANS) {
      expect(plan.limits.workers, plan.key).toBeNull();
      expect(plan.limits.storage_mb, plan.key).toBeNull();
    }
  });

  it("knows only the paid plan keys", () => {
    expect(isPaidPlanKey("pro")).toBe(true);
    expect(isPaidPlanKey("beta")).toBe(false);
    expect(isPaidPlanKey(undefined)).toBe(false);
  });

  it("shows CZK to Czech visitors and EUR to everyone else", () => {
    expect(priceCurrencyFor("cs")).toBe("CZK");
    expect(priceCurrencyFor("CZK")).toBe("CZK");
    expect(priceCurrencyFor("en")).toBe("EUR");
    expect(priceCurrencyFor("USD")).toBe("EUR");
  });

  it("reads the catalog in Czech only for Czech", () => {
    expect(catalogLocaleFor("cs")).toBe("cs");
    expect(catalogLocaleFor("en")).toBe("en");
    expect(catalogLocaleFor(null)).toBe("en");
  });
});
