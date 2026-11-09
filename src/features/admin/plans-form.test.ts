import { describe, expect, it } from "vitest";
import { validatePlanAddOns, validatePlanCatalog } from "@/features/plan/catalog";
import { seedAddOns, seedPlanCatalog } from "@/features/plan/catalog-seed";
import {
  addCurrency,
  formCurrencies,
  fromAddOnsForm,
  fromForm,
  moveCard,
  moveFeature,
  parseAmount,
  removeCurrency,
  setRecommended,
  toAddOnsForm,
  toForm,
} from "./plans-form";

describe("plans form", () => {
  it("round-trips the catalog through the fields", () => {
    expect(fromForm(toForm(seedPlanCatalog()))).toEqual(seedPlanCatalog());
  });

  it("reads typed amounts with a comma, spaces or nothing", () => {
    expect(parseAmount("1 290")).toBe(1290);
    expect(parseAmount("19,99")).toBe(19.99);
    expect(parseAmount(" ")).toBeNull();
    expect(Number.isNaN(parseAmount("12a"))).toBe(true);
  });

  it("turns an empty limit into no limit and a missing price into an error", () => {
    const form = toForm(seedPlanCatalog());
    form[0].limits.workers = "";
    form[0].monthly.CZK = "";
    const result = validatePlanCatalog(fromForm(form));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toEqual([{ path: "solo.monthly.CZK", code: "required" }]);
    form[0].monthly.CZK = "490";
    expect(fromForm(form)[0].limits.workers).toBeNull();
  });

  it("drops the price per worker when it is switched off and keeps it for switching back", () => {
    const form = toForm(seedPlanCatalog());
    form[2].perWorkerOn = false;
    expect(fromForm(form)[2].per_worker).toBeNull();
    form[2].perWorkerOn = true;
    expect(fromForm(form)[2].per_worker).toEqual({ CZK: 290, EUR: 12 });
  });

  it("orders the cards by their place and moves them", () => {
    const moved = moveCard(toForm(seedPlanCatalog()), 0, 1);
    expect(moved.map((plan) => plan.key)).toEqual(["pro", "solo", "team"]);
    expect(fromForm(moved).map((plan) => [plan.key, plan.order])).toEqual([
      ["pro", 0],
      ["solo", 1],
      ["team", 2],
    ]);
    expect(moveCard(moved, 0, -1).map((plan) => plan.key)).toEqual(["pro", "solo", "team"]);
  });

  it("moves a line where another one was", () => {
    const [, pro] = toForm(seedPlanCatalog());
    const ids = pro.features.map((feature) => feature.id);
    const moved = moveFeature(pro.features, ids[0], ids[2]);
    expect(moved.map((feature) => feature.id)).toEqual([ids[1], ids[2], ids[0], ids[3], ids[4]]);
  });

  it("gives the badge to one card only", () => {
    const form = setRecommended(toForm(seedPlanCatalog()), "team", true);
    expect(form.map((plan) => plan.recommended)).toEqual([false, false, true]);
    expect(setRecommended(form, "team", false).map((plan) => plan.recommended)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("round-trips the add-ons and gives them the cards' currencies", () => {
    const addOns = seedAddOns();
    const form = toAddOnsForm(addOns, seedPlanCatalog());
    expect(Object.keys(form[0].monthly)).toEqual(["EUR", "CZK"]);
    expect(fromAddOnsForm(form)).toEqual(addOns);
  });

  it("adds a manual currency everywhere, prefilled, and removes it again", () => {
    const start = { plans: toForm(seedPlanCatalog()), addOns: toAddOnsForm(seedAddOns()) };
    const added = addCurrency(start, "JPY", { plans: { solo: { monthly: 2990, yearly: 29900 } }, addOns: { no_branding: 159 } });
    expect(formCurrencies(added.plans)).toEqual(["EUR", "CZK", "JPY"]);
    expect(added.plans[0].monthly.JPY).toBe("2990");
    expect(added.addOns[0].monthly.JPY).toBe("159");
    // Pro and Team got empty JPY fields: no manual price there, derived from EUR.
    const catalog = fromForm(added.plans);
    expect(catalog[0].monthly.JPY).toBe(2990);
    expect("JPY" in catalog[1].monthly).toBe(false);
    expect(validatePlanCatalog(catalog).ok).toBe(true);
    expect(validatePlanAddOns(fromAddOnsForm(added.addOns)).ok).toBe(true);
    const removed = removeCurrency(added, "JPY");
    expect(formCurrencies(removed.plans)).toEqual(["EUR", "CZK"]);
    expect(fromForm(removed.plans)).toEqual(seedPlanCatalog());
    // EUR is the base and never goes.
    expect(formCurrencies(removeCurrency(start, "EUR").plans)).toEqual(["EUR", "CZK"]);
  });

  it("leaves out a currency whose fields are all empty", () => {
    const form = toForm(seedPlanCatalog());
    form[0].monthly.CZK = "";
    form[0].yearly.CZK = "";
    expect("CZK" in fromForm(form)[0].monthly).toBe(false);
    expect(validatePlanCatalog(fromForm(form)).ok).toBe(true);
  });
});
