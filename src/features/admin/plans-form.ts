import {
  PLAN_LIMIT_KEYS,
  type AddOnKey,
  type CatalogAddOn,
  type CatalogPlan,
  type CatalogText,
  type Money,
  type PaidPlanKey,
  type PlanCatalog,
  type PlanLimitKey,
} from "@/config/pricing";
import { moneyCurrencies, sortedPlans } from "@/features/plan/catalog";
import { BASE_CURRENCY } from "@/lib/currency";

/**
 * The plan editor's state: the catalog with every number as the text in its
 * field (so "19," can be typed), the cards in their order and an id per line
 * for dragging. fromForm() turns it back into a payload for validatePlanCatalog().
 *
 * Prices (step 24.1): every price object of the form has the same currencies,
 * EUR first and then the manual ones of the whole catalog (formCurrencies).
 * A currency whose fields are all empty in a plan or an add-on is no manual
 * price there: fromForm() leaves it out and the price is derived from EUR.
 */

export type FormFeature = { id: string; cs: string; en: string; highlight: boolean };
/** Currency → the typed amount; EUR always, then the manual currencies. */
export type FormMoney = Record<string, string>;

export type FormPlan = {
  key: PaidPlanKey;
  name: CatalogText;
  tagline: CatalogText;
  monthly: FormMoney;
  yearly: FormMoney;
  /** Off = no price per worker (null in the catalog); the amounts stay for switching back. */
  perWorkerOn: boolean;
  per_worker: FormMoney;
  /** Workers without a plan of their own that the price covers. */
  included_workers: string;
  limits: Record<PlanLimitKey, string>;
  features: FormFeature[];
  recommended: boolean;
};

let nextId = 0;
export function featureId(): string {
  nextId += 1;
  return `feature-${nextId}`;
}

const text = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

const moneyText = (money: Money | null, currencies: readonly string[]): FormMoney =>
  Object.fromEntries(currencies.map((currency) => [currency, text(money?.[currency])]));

/** EUR, then every manual currency of the plans and add-ons A–Z. */
function catalogCurrencies(catalog: readonly CatalogPlan[], addOns: readonly CatalogAddOn[] = []): string[] {
  const all = new Set<string>();
  for (const plan of catalog) {
    for (const money of [plan.monthly, plan.yearly, plan.per_worker]) {
      for (const currency of money ? moneyCurrencies(money) : []) all.add(currency);
    }
  }
  for (const addOn of addOns) for (const currency of moneyCurrencies(addOn.monthly)) all.add(currency);
  all.delete(BASE_CURRENCY);
  return [BASE_CURRENCY, ...[...all].sort()];
}

/** The cards in order, numbers as text. `addOns` adds their manual currencies to every card. */
export function toForm(catalog: readonly CatalogPlan[], addOns: readonly CatalogAddOn[] = []): FormPlan[] {
  const currencies = catalogCurrencies(catalog, addOns);
  return sortedPlans(catalog).map((plan) => ({
    key: plan.key,
    name: { ...plan.name },
    tagline: { ...plan.tagline },
    monthly: moneyText(plan.monthly, currencies),
    yearly: moneyText(plan.yearly, currencies),
    perWorkerOn: plan.per_worker !== null,
    per_worker: moneyText(plan.per_worker, currencies),
    included_workers: text(plan.included_workers),
    limits: Object.fromEntries(
      PLAN_LIMIT_KEYS.map((limit) => [limit, text(plan.limits[limit])]),
    ) as Record<PlanLimitKey, string>,
    features: plan.features.map((feature) => ({ ...feature, id: featureId() })),
    recommended: plan.recommended,
  }));
}

/**
 * A typed amount: spaces ignored, a decimal comma or point. Empty is null
 * (an empty limit = no limit); anything else that is not a number is NaN,
 * which validation reports as "not a number".
 */
export function parseAmount(value: string): number | null {
  const cleaned = value.replace(/[\s ]/g, "").replace(",", ".");
  if (cleaned === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}

const filled = (value: string | undefined) => (value ?? "").trim() !== "";

/**
 * The currencies a plan or an add-on has a price in: EUR always, a manual
 * one as soon as any of its fields is filled (an empty one then is an error).
 */
function pricedCurrencies(moneys: readonly FormMoney[]): string[] {
  const keys = new Set(moneys.flatMap((money) => Object.keys(money)));
  return [...keys].filter(
    (currency) => currency === BASE_CURRENCY || moneys.some((money) => filled(money[currency])),
  );
}

const moneyValue = (money: FormMoney, currencies: readonly string[]) =>
  Object.fromEntries(currencies.map((currency) => [currency, parseAmount(money[currency] ?? "")]));

/** The payload as it would be saved; the order is the order of the cards. */
export function fromForm(form: readonly FormPlan[]): PlanCatalog {
  return form.map((plan, order) => {
    const currencies = pricedCurrencies(
      plan.perWorkerOn ? [plan.monthly, plan.yearly, plan.per_worker] : [plan.monthly, plan.yearly],
    );
    return {
    key: plan.key,
    name: { ...plan.name },
    tagline: { ...plan.tagline },
    monthly: moneyValue(plan.monthly, currencies),
    yearly: moneyValue(plan.yearly, currencies),
    per_worker: plan.perWorkerOn ? moneyValue(plan.per_worker, currencies) : null,
    // Empty is none in the price.
    included_workers: parseAmount(plan.included_workers) ?? 0,
    limits: Object.fromEntries(
      PLAN_LIMIT_KEYS.map((limit) => [limit, parseAmount(plan.limits[limit])]),
    ),
    features: plan.features.map(({ cs, en, highlight }) => ({ cs, en, highlight })),
    recommended: plan.recommended,
    order,
    };
  }) as PlanCatalog;
}

// ---------------------------------------------------------------------------
// Currencies of the manual prices
// ---------------------------------------------------------------------------

/** The currencies the form has fields for: EUR, then the manual ones. */
export function formCurrencies(form: readonly FormPlan[]): string[] {
  return Object.keys(form[0]?.monthly ?? { [BASE_CURRENCY]: "" });
}

const withCurrency = (money: FormMoney, currency: string, value = ""): FormMoney =>
  currency in money ? money : { ...money, [currency]: value };

const withoutCurrency = (money: FormMoney, currency: string): FormMoney =>
  Object.fromEntries(Object.entries(money).filter(([code]) => code !== currency));

/**
 * Adds fields for a manual price in `currency` to every card and add-on,
 * prefilled with `prefill` (the derived prices, for "set by hand"); a
 * currency the form has already stays as typed.
 */
export function addCurrency(
  form: { plans: readonly FormPlan[]; addOns: readonly FormAddOn[] },
  currency: string,
  prefill?: {
    plans?: Partial<Record<PaidPlanKey, Partial<Record<"monthly" | "yearly" | "per_worker", number>>>>;
    addOns?: Partial<Record<AddOnKey, number>>;
  },
): { plans: FormPlan[]; addOns: FormAddOn[] } {
  if (currency === BASE_CURRENCY) return { plans: [...form.plans], addOns: [...form.addOns] };
  return {
    plans: form.plans.map((plan) => {
      const values = prefill?.plans?.[plan.key];
      return {
        ...plan,
        monthly: withCurrency(plan.monthly, currency, text(values?.monthly)),
        yearly: withCurrency(plan.yearly, currency, text(values?.yearly)),
        per_worker: withCurrency(plan.per_worker, currency, text(values?.per_worker)),
      };
    }),
    addOns: form.addOns.map((addOn) => ({
      ...addOn,
      monthly: withCurrency(addOn.monthly, currency, text(prefill?.addOns?.[addOn.key])),
    })),
  };
}

/** Removes the manual price in `currency` everywhere: it is then derived from EUR again. */
export function removeCurrency(
  form: { plans: readonly FormPlan[]; addOns: readonly FormAddOn[] },
  currency: string,
): { plans: FormPlan[]; addOns: FormAddOn[] } {
  if (currency === BASE_CURRENCY) return { plans: [...form.plans], addOns: [...form.addOns] };
  return {
    plans: form.plans.map((plan) => ({
      ...plan,
      monthly: withoutCurrency(plan.monthly, currency),
      yearly: withoutCurrency(plan.yearly, currency),
      per_worker: withoutCurrency(plan.per_worker, currency),
    })),
    addOns: form.addOns.map((addOn) => ({ ...addOn, monthly: withoutCurrency(addOn.monthly, currency) })),
  };
}

// ---------------------------------------------------------------------------
// Add-ons (step 24.1)
// ---------------------------------------------------------------------------

export type FormAddOn = {
  key: AddOnKey;
  name: CatalogText;
  description: CatalogText;
  monthly: FormMoney;
};

/** The add-ons in their order, with the same currencies as the cards. */
export function toAddOnsForm(addOns: readonly CatalogAddOn[], catalog: readonly CatalogPlan[] = []): FormAddOn[] {
  const currencies = catalogCurrencies(catalog, addOns);
  return [...addOns]
    .sort((a, b) => a.order - b.order)
    .map((addOn) => ({
      key: addOn.key,
      name: { ...addOn.name },
      description: { ...addOn.description },
      monthly: moneyText(addOn.monthly, currencies),
    }));
}

/** The add-ons as they would be saved (for validatePlanAddOns()); the order is the form's. */
export function fromAddOnsForm(form: readonly FormAddOn[]): CatalogAddOn[] {
  return form.map((addOn, order) => ({
    key: addOn.key,
    name: { ...addOn.name },
    description: { ...addOn.description },
    monthly: moneyValue(addOn.monthly, pricedCurrencies([addOn.monthly])) as Money,
    order,
  }));
}

/** Moves the card at `index` one place left (-1) or right (+1). */
export function moveCard(form: readonly FormPlan[], index: number, step: -1 | 1): FormPlan[] {
  const target = index + step;
  if (target < 0 || target >= form.length) return [...form];
  const next = [...form];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Moves a line of a card to where another one was (dragging). */
export function moveFeature(features: readonly FormFeature[], from: string, to: string): FormFeature[] {
  const start = features.findIndex((feature) => feature.id === from);
  const end = features.findIndex((feature) => feature.id === to);
  if (start < 0 || end < 0) return [...features];
  const next = [...features];
  const [moved] = next.splice(start, 1);
  next.splice(end, 0, moved);
  return next;
}

/** Only one card carries the badge: switching it on takes it from the others. */
export function setRecommended(form: readonly FormPlan[], key: PaidPlanKey, on: boolean): FormPlan[] {
  return form.map((plan) => ({
    ...plan,
    recommended: plan.key === key ? on : on ? false : plan.recommended,
  }));
}
