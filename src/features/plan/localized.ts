import type { CatalogAddOn, CatalogPlan, Money, PlanCatalog } from "@/config/pricing";
import { BASE_CURRENCY, currencyDigits } from "@/lib/currency";
import { freshRate, rateDate, type RateTable } from "@/lib/exchange-rates";
import { psychologicalPrice } from "@/lib/psychological-price";

/**
 * Plan prices in any currency (step 24.1). A manual price of the catalog
 * wins and no rate changes it; any other currency is derived from the EUR
 * price at the day's rate and rounded to a selling price
 * (psychologicalPrice, at most 8 % from the exact conversion). A rate older
 * than RATE_MAX_AGE_DAYS is never used: the price is then shown in EUR.
 * Shared by the website, Settings → Subscription, the administration and
 * the server; nothing derived is ever stored.
 */

/** A manual price further than this from the rate gets a warning in the administration. */
export const MANUAL_DEVIATION_WARN = 0.15;

export type PriceOrigin = "manual" | "derived";

/** The exact conversion of the EUR price, unrounded; null without a fresh rate. */
export function exactPrice(money: Money, currency: string, table: RateTable, now = new Date()): number | null {
  const rate = freshRate(table, currency, now);
  return rate === null ? null : money.EUR * rate;
}

/** A price in a currency: the manual one, else derived; null when there is no fresh rate. */
export function moneyIn(
  money: Money,
  currency: string,
  table: RateTable,
  now = new Date(),
): { amount: number; origin: PriceOrigin } | null {
  const manual = money[currency];
  if (typeof manual === "number") return { amount: manual, origin: "manual" };
  const exact = exactPrice(money, currency, table, now);
  return exact === null ? null : { amount: psychologicalPrice(exact, currency), origin: "derived" };
}

/** How far a manual price is from the rate, as a share (0.2 = 20 % above); null without one. */
export function manualDeviation(
  money: Money,
  currency: string,
  table: RateTable,
  now = new Date(),
): number | null {
  const manual = money[currency];
  if (typeof manual !== "number" || currency === BASE_CURRENCY) return null;
  const exact = exactPrice(money, currency, table, now);
  return exact ? (manual - exact) / exact : null;
}

const roundTo = (value: number, currency: string) => {
  const factor = 10 ** Math.min(currencyDigits(currency), 2);
  return Math.round(value * factor) / factor;
};

/**
 * One plan with prices in `currency` filled in (monthly, yearly, per worker),
 * or null when it has no manual price there and no fresh rate. A year that
 * is a whole number of months in EUR (10 months for 12) stays so: the derived
 * monthly price times the same number, so "2 months free" holds everywhere.
 */
export function localizePlan(
  plan: CatalogPlan,
  currency: string,
  table: RateTable,
  now = new Date(),
): CatalogPlan | null {
  if (typeof plan.monthly[currency] === "number") return plan;
  const monthly = moneyIn(plan.monthly, currency, table, now);
  if (!monthly) return null;
  const months = plan.yearly.EUR / plan.monthly.EUR;
  const yearly = Number.isInteger(Math.round(months * 1e6) / 1e6)
    ? roundTo(monthly.amount * Math.round(months), currency)
    : Math.min(moneyIn(plan.yearly, currency, table, now)?.amount ?? 0, 12 * monthly.amount);
  const perWorker = plan.per_worker ? moneyIn(plan.per_worker, currency, table, now) : null;
  return {
    ...plan,
    monthly: { ...plan.monthly, [currency]: monthly.amount },
    yearly: { ...plan.yearly, [currency]: yearly },
    per_worker: plan.per_worker && perWorker ? { ...plan.per_worker, [currency]: perWorker.amount } : null,
  };
}

export type LocalizedPlans = {
  /** The plans with prices in `currency`. */
  plans: PlanCatalog;
  /** What is shown: the wanted currency, or EUR when its rate is missing or stale. */
  currency: string;
  /** The currency asked for. */
  wanted: string;
  /** Some price is converted at a rate (shown with "roughly at the rate of …"). */
  derived: boolean;
  /** When the rate used was fetched; null when nothing is derived. */
  rateAt: string | null;
};

/** The catalog in the wanted currency, else in EUR. */
export function localizePlans(
  catalog: readonly CatalogPlan[],
  wanted: string,
  table: RateTable,
  now = new Date(),
): LocalizedPlans {
  const plans: CatalogPlan[] = [];
  for (const plan of catalog) {
    const localized = localizePlan(plan, wanted, table, now);
    if (!localized) {
      return { plans: [...catalog], currency: BASE_CURRENCY, wanted, derived: false, rateAt: null };
    }
    plans.push(localized);
  }
  const derived = catalog.some((plan) => typeof plan.monthly[wanted] !== "number");
  return { plans, currency: wanted, wanted, derived, rateAt: derived ? rateDate(table, wanted) : null };
}

/** The monthly price of an add-on in a currency, else in EUR. */
export function addOnPrice(
  addOn: CatalogAddOn,
  wanted: string,
  table: RateTable,
  now = new Date(),
): { amount: number; currency: string; origin: PriceOrigin } {
  const price = moneyIn(addOn.monthly, wanted, table, now);
  if (price) return { ...price, currency: wanted };
  return { amount: addOn.monthly.EUR, currency: BASE_CURRENCY, origin: "manual" };
}

/** An add-on for one period: the month, or twelve months paid yearly. */
export function addOnPeriodPrice(monthly: number, billing: "monthly" | "yearly", currency: string): number {
  return billing === "monthly" ? monthly : roundTo(monthly * 12, currency);
}

/**
 * The currency a plan is charged in: the wanted one when the catalog has a
 * manual price there (a derived price moves with the rate, so it is never
 * charged), else EUR.
 */
export function chargeCurrency(plan: CatalogPlan, wanted: string): string {
  return typeof plan.monthly[wanted] === "number" ? wanted : BASE_CURRENCY;
}
