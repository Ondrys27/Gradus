import {
  PAID_PLAN_KEYS,
  isAddOnKey,
  isPaidPlanKey,
  type AddOnKey,
  type Billing,
  type CatalogAddOn,
  type CatalogPlan,
  type PaidPlanKey,
  type PlanCatalog,
  type PriceCurrency,
} from "@/config/pricing";
import { moneyCurrencies, perWorkerPrice } from "@/features/plan/catalog";
import { addOnPeriodPrice } from "@/features/plan/localized";

/**
 * The Stripe prices of a published catalog version (step 23.1). The catalog
 * is the only source of prices: each version gets a Price per plan ×
 * currency × period, and one per extra worker where the plan takes them,
 * found again by its lookup key `plan:<key>:<currency>:<period>:v<version>`
 * (`worker:…` for workers, `addon:<key>:…` for add-ons, step 24.1). The
 * currencies are EUR and those with a manual price in the catalog: a price
 * derived at the day's rate is only shown, never charged. A Price never
 * changes in Stripe; a new version makes new ones and the old ones are only
 * archived.
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
  if (!isPaidPlanKey(plan)) return null;
  return {
    kind: kind as PriceKind,
    plan,
    currency,
    billing: billing as Billing,
    version: Number(version),
  };
}

/** Stripe's zero-decimal currencies: amounts in whole units. */
const STRIPE_ZERO_DECIMAL = [
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF",
  "XOF", "XPF",
];
/** Stripe's three-decimal currencies: thousandths, the last one always 0. */
const STRIPE_THREE_DECIMAL = ["BHD", "JOD", "KWD", "OMR", "TND"];

/** How many of Stripe's smallest units make one unit of a currency. */
export function stripeUnitFactor(currency: string): number {
  const code = currency.toUpperCase();
  if (STRIPE_ZERO_DECIMAL.includes(code)) return 1;
  if (STRIPE_THREE_DECIMAL.includes(code)) return 1000;
  return 100;
}

/** An amount in Stripe's smallest unit of the currency (cents, or yen). */
export function minorUnits(amount: number, currency: string): number {
  const factor = stripeUnitFactor(currency);
  const minor = Math.round(amount * factor);
  return factor === 1000 ? Math.round(minor / 10) * 10 : minor;
}
export const fromMinorUnits = (amount: number, currency: string) =>
  Math.round(amount) / stripeUnitFactor(currency);

// ---------------------------------------------------------------------------
// Add-ons (step 24.1)
// ---------------------------------------------------------------------------

export type AddOnPriceKey = { addOn: AddOnKey; currency: PriceCurrency; billing: Billing; version: number };

export const addOnLookupKey = (key: AddOnPriceKey) =>
  `addon:${key.addOn}:${key.currency}:${key.billing}:v${key.version}`;

const ADD_ON_LOOKUP = /^addon:([a-z_]+):([A-Z]{3}):(monthly|yearly):v(\d{1,6})$/;

export function parseAddOnLookupKey(value: string | null | undefined): AddOnPriceKey | null {
  const match = ADD_ON_LOOKUP.exec(value ?? "");
  if (!match) return null;
  const [, addOn, currency, billing, version] = match;
  if (!isAddOnKey(addOn)) return null;
  return { addOn, currency, billing: billing as Billing, version: Number(version) };
}

export const addOnProductId = (addOn: AddOnKey) => `gradus_addon_${addOn}`;

export type AddOnPriceSpec = AddOnPriceKey & { lookupKey: string; productId: string; unitAmount: number };

/** Every Price the add-ons of a version need: EUR and the manual currencies × both periods. */
export function addOnPriceSpecs(addOns: readonly CatalogAddOn[], version: number): AddOnPriceSpec[] {
  const specs: AddOnPriceSpec[] = [];
  for (const addOn of addOns) {
    for (const currency of moneyCurrencies(addOn.monthly)) {
      for (const billing of BILLINGS) {
        const key = { addOn: addOn.key, currency, billing, version };
        specs.push({
          ...key,
          lookupKey: addOnLookupKey(key),
          productId: addOnProductId(addOn.key),
          unitAmount: minorUnits(addOnPeriodPrice(addOn.monthly[currency], billing, currency), currency),
        });
      }
    }
  }
  return specs;
}

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
    // EUR and the currencies with a manual price; a derived price is never charged.
    for (const currency of moneyCurrencies(plan.monthly)) {
      for (const billing of BILLINGS) {
        const base = { plan: planKey, currency, billing, version };
        specs.push({
          ...base,
          kind: "plan",
          lookupKey: priceLookupKey({ ...base, kind: "plan" }),
          productId: productIdFor("plan", planKey),
          unitAmount: minorUnits(planPeriodPrice(plan, currency, billing), currency),
        });
        const worker = workerPeriodPrice(plan, currency, billing);
        if (worker !== null) {
          specs.push({
            ...base,
            kind: "worker",
            lookupKey: priceLookupKey({ ...base, kind: "worker" }),
            productId: productIdFor("worker", planKey),
            unitAmount: minorUnits(worker, currency),
          });
        }
      }
    }
  }
  return specs;
}
