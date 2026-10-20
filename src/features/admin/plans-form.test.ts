import { describe, expect, it } from "vitest";
import { validatePlanCatalog } from "@/features/plan/catalog";
import { seedPlanCatalog } from "@/features/plan/catalog-seed";
import { fromForm, moveCard, moveFeature, parseAmount, setRecommended, toForm } from "./plans-form";

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
});
