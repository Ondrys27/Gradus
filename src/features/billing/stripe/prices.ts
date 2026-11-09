import {
  PAID_PLAN_KEYS,
  PRICE_CURRENCIES,
  isPaidPlanKey,
  type Billing,
  type CatalogPlan,
  type PaidPlanKey,
  type PlanCatalog,
  type PriceCurrency,
} from "@/config/pricing";
import { perWorkerPrice } from "@/features/plan/catalog";

/**
 * The Stripe prices of a published catalog version (step 23.1). The catalog
 * is the only source of prices: each version gets a Price per plan ×
 * currency × period, and one per extra worker where the plan takes them,
 * found again by its lookup key `plan:<key>:<currency>:<period>:v<version>`
 * (`worker:…` for workers). A Price never changes in Stripe; a new version
 * makes new ones and the old ones are only archived.
 */

export type PriceKind = "plan" | "worker";
const BILLINGS: readonly Billing[] = ["monthly", "yearly"];

export type PriceKey = {
  kind: PriceKind;
  plan: PaidPlanKey;
  currency: PriceCurrency;
  billing: Billing;
  version: number;
};

export function priceLookupKey(key: PriceKey): string {
  return `${key.kind}:${key.plan}:${key.currency}:${key.billing}:v${key.version}`;
}

const LOOKUP = /^(plan|worker):([a-z]+):([A-Z]{3}):(monthly|yearly):v(\d{1,6})$/;

export function parseLookupKey(value: string | null | undefined): PriceKey | null {
  const match = LOOKUP.exec(value ?? "");
  if (!match) return null;
  const [, kind, plan, currency, billing, version] = match;
  if (!isPaidPlanKey(plan) || !(PRICE_CURRENCIES as readonly string[]).includes(currency)) return null;
  return {
    kind: kind as PriceKind,
    plan,
    currency: currency as PriceCurrency,
    billing: billing as Billing,
    version: Number(version),
  };
}

/** Stripe counts in the smallest unit; CZK and EUR both have two decimals there. */
export const minorUnits = (amount: number) => Math.round(amount * 100);
export const fromMinorUnits = (amount: number) => Math.round(amount) / 100;

/** The Stripe Product of a plan, and the one of extra workers. Same id in both modes. */
export const productIdFor = (kind: PriceKind, plan: PaidPlanKey) =>
  kind === "plan" ? `gradus_plan_${plan}` : "gradus_extra_worker";

export type PriceSpec = PriceKey & {
  lookupKey: string;
  productId: string;
  /** Of one period, in the smallest unit. */
  unitAmount: number;
};

/** The price of one plan period: the month, or the whole year. */
export function planPeriodPrice(plan: CatalogPlan, currency: PriceCurrency, billing: Billing): number {
  return billing === "monthly" ? plan.monthly[currency] : plan.yearly[currency];
}

/**
 * One extra worker for one period, as Settings → Subscription shows it: the
 * monthly price, a year at twelve discounted months (perWorkerPrice). Null
 * when the plan takes no extra workers.
 */
export function workerPeriodPrice(
  plan: CatalogPlan,
  currency: PriceCurrency,
  billing: Billing,
): number | null {
  const monthly = perWorkerPrice(plan, currency, billing);
  if (monthly === null) return null;
  return billing === "monthly" ? monthly : Math.round(monthly * 12 * 100) / 100;
}

/** Every Price a catalog version needs in Stripe. */
export function catalogPriceSpecs(catalog: PlanCatalog, version: number): PriceSpec[] {
  const specs: PriceSpec[] = [];
  for (const planKey of PAID_PLAN_KEYS) {
    const plan = catalog.find((candidate) => candidate.key === planKey);
    if (!plan) continue;
    for (const currency of PRICE_CURRENCIES) {
      for (const billing of BILLINGS) {
        const base = { plan: planKey, currency, billing, version };
        specs.push({
          ...base,
          kind: "plan",
          lookupKey: priceLookupKey({ ...base, kind: "plan" }),
          productId: productIdFor("plan", planKey),
          unitAmount: minorUnits(planPeriodPrice(plan, currency, billing)),
        });
        const worker = workerPeriodPrice(plan, currency, billing);
        if (worker !== null) {
          specs.push({
            ...base,
            kind: "worker",
            lookupKey: priceLookupKey({ ...base, kind: "worker" }),
            productId: productIdFor("worker", planKey),
            unitAmount: minorUnits(worker),
          });
        }
      }
    }
  }
  return specs;
}
