import { describe, expect, it } from "vitest";
import { ADD_ON_KEYS, ADD_ON_SEED_PRICES, catalogLocaleFor, isAddOnKey, isPaidPlanKey, PAID_PLANS } from "./pricing";

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

  it("prices every plan in EUR, with CZK as the manual price", () => {
    for (const plan of PAID_PLANS) {
      expect(Object.keys(plan.monthly).sort(), plan.key).toEqual(["CZK", "EUR"]);
    }
  });

  it("sells the add-on without branding for 0,99 € or 29 Kč a month", () => {
    expect(ADD_ON_KEYS).toEqual(["no_branding"]);
    expect(ADD_ON_SEED_PRICES.no_branding).toEqual({ EUR: 0.99, CZK: 29 });
    expect(isAddOnKey("no_branding")).toBe(true);
    expect(isAddOnKey("pro")).toBe(false);
  });

  it("reads the catalog in Czech only for Czech", () => {
    expect(catalogLocaleFor("cs")).toBe("cs");
    expect(catalogLocaleFor("en")).toBe("en");
    expect(catalogLocaleFor(null)).toBe("en");
  });
});
