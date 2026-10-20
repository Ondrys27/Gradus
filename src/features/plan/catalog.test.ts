import { describe, expect, it } from "vitest";
import type { CatalogPlan, PlanCatalog } from "@/config/pricing";
import {
  diffPlanCatalogs,
  featureText,
  loweredLimits,
  monthlyPrice,
  perWorkerPrice,
  planName,
  sortedPlans,
  validatePlanCatalog,
  yearlyMonthsFree,
  yearlyPrice,
} from "./catalog";
import { seedPlanCatalog } from "./catalog-seed";

const seed = () => structuredClone(seedPlanCatalog());
const plan = (catalog: PlanCatalog, key: string) => catalog.find((p) => p.key === key)!;
function changed(key: string, change: (plan: CatalogPlan) => void): PlanCatalog {
  const catalog = seed();
  change(plan(catalog, key));
  return catalog;
}
const codes = (input: unknown) => {
  const result = validatePlanCatalog(input);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}:${issue.code}`);
};

describe("validatePlanCatalog", () => {
  it("accepts the seed and returns it by order", () => {
    const result = validatePlanCatalog(seed());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.catalog.map((p) => p.key)).toEqual(["solo", "pro", "team"]);
  });

  it("trims texts and sorts by order", () => {
    const catalog = changed("solo", (p) => {
      p.name.cs = "  Solo  ";
      p.order = 2;
    });
    plan(catalog, "team").order = 0;
    const result = validatePlanCatalog(catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.catalog.map((p) => p.key)).toEqual(["team", "pro", "solo"]);
    expect(plan(result.catalog, "solo").name.cs).toBe("Solo");
  });

  it("wants positive prices with at most two decimals", () => {
    expect(codes(changed("solo", (p) => (p.monthly.CZK = 0)))).toEqual(["solo.monthly.CZK:positive"]);
    expect(codes(changed("solo", (p) => (p.monthly.EUR = -1)))).toContain("solo.monthly.EUR:positive");
    expect(codes(changed("solo", (p) => (p.monthly.EUR = 19.999)))).toEqual([
      "solo.monthly.EUR:decimals",
    ]);
    expect(codes(changed("solo", (p) => (p.monthly.EUR = Number.NaN)))).toEqual([
      "solo.monthly.EUR:number",
    ]);
    expect(codes(changed("solo", (p) => (p.monthly.EUR = null as never)))).toEqual([
      "solo.monthly.EUR:required",
    ]);
    expect(codes(changed("team", (p) => (p.per_worker!.CZK = 0)))).toEqual([
      "team.per_worker.CZK:positive",
    ]);
    expect(validatePlanCatalog(changed("solo", (p) => (p.monthly.EUR = 19.99))).ok).toBe(true);
  });

  it("allows a year of at most twelve months", () => {
    expect(validatePlanCatalog(changed("pro", (p) => (p.yearly.CZK = 12 * 890))).ok).toBe(true);
    expect(codes(changed("pro", (p) => (p.yearly.CZK = 12 * 890 + 1)))).toEqual([
      "pro.yearly.CZK:yearlyTooHigh",
    ]);
  });

  it("keeps the keys solo, pro and team and nothing else", () => {
    expect(codes(seed().slice(0, 2))).toEqual(["catalog:keys"]);
    expect(codes(changed("solo", (p) => (p.key = "pro")))).toEqual(["catalog:keys"]);
    expect(codes(changed("solo", (p) => (p.key = "beta" as never)))).toEqual(["catalog:keys"]);
    expect(codes(null)).toEqual(["catalog:keys"]);
    expect(codes(changed("solo", (p) => Object.assign(p, { extra: 1 })))).toEqual(["solo:invalid"]);
  });

  it("wants whole limits from 0, empty only for workers and storage", () => {
    expect(codes(changed("solo", (p) => (p.limits.ai_calls = 1.5)))).toEqual([
      "solo.limits.ai_calls:integer",
    ]);
    expect(codes(changed("solo", (p) => (p.limits.ai_calls = -1)))).toEqual([
      "solo.limits.ai_calls:range",
    ]);
    expect(codes(changed("solo", (p) => (p.limits.ai_calls = null as never)))).toEqual([
      "solo.limits.ai_calls:required",
    ]);
    expect(validatePlanCatalog(changed("solo", (p) => (p.limits.workers = 0))).ok).toBe(true);
    expect(validatePlanCatalog(changed("solo", (p) => (p.limits.storage_mb = null))).ok).toBe(true);
  });

  it("checks names, taglines and the lines of a card in both languages", () => {
    expect(codes(changed("solo", (p) => (p.name.en = "  ")))).toEqual(["solo.name.en:required"]);
    expect(codes(changed("solo", (p) => (p.name.cs = "x".repeat(41))))).toEqual([
      "solo.name.cs:tooLong",
    ]);
    expect(validatePlanCatalog(changed("solo", (p) => (p.tagline.cs = ""))).ok).toBe(true);
    expect(codes(changed("solo", (p) => (p.features[1].en = "")))).toEqual([
      "solo.features.1.en:required",
    ]);
    expect(
      codes(changed("solo", (p) => (p.features = Array.from({ length: 13 }, () => p.features[0])))),
    ).toEqual(["solo.features:tooManyFeatures"]);
  });

  it("gives the badge to one plan at most and every plan its own position", () => {
    expect(codes(changed("solo", (p) => (p.recommended = true)))).toEqual(["catalog:recommended"]);
    expect(codes(changed("solo", (p) => (p.order = 1)))).toEqual(["catalog:order"]);
    expect(codes(changed("solo", (p) => (p.order = 3)))).toContain("solo.order:order");
  });
});

describe("prices on a card", () => {
  const catalog = seed();

  it("matches what the website showed before the catalog", () => {
    expect(yearlyPrice(plan(catalog, "solo"), "CZK")).toBe(4900);
    expect(monthlyPrice(plan(catalog, "pro"), "EUR", "monthly")).toBe(35);
    expect(monthlyPrice(plan(catalog, "pro"), "CZK", "yearly")).toBe(742);
    expect(monthlyPrice(plan(catalog, "solo"), "EUR", "yearly")).toBe(16);
    expect(perWorkerPrice(plan(catalog, "team"), "CZK", "monthly")).toBe(290);
    expect(perWorkerPrice(plan(catalog, "team"), "CZK", "yearly")).toBe(242);
    expect(perWorkerPrice(plan(catalog, "team"), "EUR", "yearly")).toBe(10);
    expect(perWorkerPrice(plan(catalog, "pro"), "CZK", "monthly")).toBeNull();
    expect(yearlyMonthsFree(catalog, "CZK")).toBe(2);
    expect(yearlyMonthsFree(catalog, "EUR")).toBe(2);
  });

  it("keeps cents when the price has them", () => {
    const cents = changed("solo", (p) => {
      p.monthly.EUR = 19.99;
      p.yearly.EUR = 199.9;
    });
    expect(monthlyPrice(plan(cents, "solo"), "EUR", "yearly")).toBe(16.66);
  });

  it("leaves the months-free badge out when the plans differ", () => {
    expect(yearlyMonthsFree(changed("solo", (p) => (p.yearly.CZK = 490 * 11)), "CZK")).toBeNull();
    expect(yearlyMonthsFree(changed("solo", (p) => (p.yearly.CZK = 5000)), "CZK")).toBeNull();
    const none = seed().map((p) => ({ ...p, yearly: { CZK: p.monthly.CZK * 12, EUR: p.monthly.EUR * 12 } }));
    expect(yearlyMonthsFree(none, "EUR")).toBeNull();
  });

  it("fills a line with the plan's limits", () => {
    const solo = plan(catalog, "solo");
    const format = (value: number) => `#${value}`;
    expect(featureText(solo.features[1], solo, "cs", format, "∞")).toBe(
      "#100 vygenerovaných kontaktů měsíčně",
    );
    const line = { cs: "{workers} pracovníků, {nothing}", en: "x", highlight: false };
    expect(featureText(line, solo, "cs", format, "bez limitu")).toBe("bez limitu pracovníků, {nothing}");
  });

  it("names plans in the language asked, null outside the catalog", () => {
    expect(planName(catalog, "team", "cs")).toBe("Tým");
    expect(planName(catalog, "team", "en")).toBe("Team");
    expect(planName(catalog, "beta", "cs")).toBeNull();
    expect(sortedPlans([...catalog].reverse()).map((p) => p.key)).toEqual(["solo", "pro", "team"]);
  });
});

describe("diffPlanCatalogs", () => {
  it("finds nothing between equal versions", () => {
    expect(diffPlanCatalogs(seed(), seed())).toEqual([]);
  });

  it("lists every changed value with from and to", () => {
    const next = changed("pro", (p) => {
      p.monthly.CZK = 990;
      p.name.en = "Pro+";
      p.limits.workers = 3;
      p.per_worker = { CZK: 100, EUR: 4 };
    });
    expect(diffPlanCatalogs(seed(), next)).toEqual([
      { plan: "pro", field: "name.en", from: "Pro", to: "Pro+" },
      { plan: "pro", field: "monthly.CZK", from: 890, to: 990 },
      { plan: "pro", field: "per_worker.CZK", from: null, to: 100 },
      { plan: "pro", field: "per_worker.EUR", from: null, to: 4 },
      { plan: "pro", field: "limits.workers", from: null, to: 3 },
    ]);
  });

  it("reports the lines of a card, the badge and the order as changes", () => {
    const next = seed();
    plan(next, "solo").features.push({ cs: "Nové", en: "New", highlight: true });
    plan(next, "solo").recommended = true;
    plan(next, "pro").recommended = false;
    plan(next, "solo").order = 1;
    plan(next, "pro").order = 0;
    const changes = diffPlanCatalogs(seed(), next);
    expect(changes.map((c) => `${c.plan}.${c.field}`)).toEqual([
      "pro.recommended",
      "pro.order",
      "solo.features",
      "solo.recommended",
      "solo.order",
    ]);
    expect((changes.find((c) => c.field === "features")!.to as unknown[]).length).toBe(4);
  });
});

describe("loweredLimits", () => {
  it("finds limits that go down, an empty limit being the highest", () => {
    const next = changed("team", (p) => {
      p.limits.workers = 5;
      p.limits.ai_calls = 2000;
      p.limits.daily_contacts = 50;
    });
    expect(loweredLimits(seed(), next)).toEqual([
      { plan: "team", limit: "daily_contacts", from: 100, to: 50 },
      { plan: "team", limit: "workers", from: null, to: 5 },
    ]);
    expect(loweredLimits(next, seed())).toEqual([
      { plan: "team", limit: "ai_calls", from: 2000, to: 1500 },
    ]);
  });
});
