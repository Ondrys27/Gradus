import {
  PLAN_LIMIT_KEYS,
  PRICE_CURRENCIES,
  type CatalogPlan,
  type CatalogText,
  type PaidPlanKey,
  type PlanCatalog,
  type PlanLimitKey,
  type PriceCurrency,
} from "@/config/pricing";
import { sortedPlans } from "@/features/plan/catalog";

/**
 * The plan editor's state: the catalog with every number as the text in its
 * field (so "19," can be typed), the cards in their order and an id per line
 * for dragging. fromForm() turns it back into a payload for validatePlanCatalog().
 */

export type FormFeature = { id: string; cs: string; en: string; highlight: boolean };
export type FormMoney = Record<PriceCurrency, string>;

export type FormPlan = {
  key: PaidPlanKey;
  name: CatalogText;
  tagline: CatalogText;
  monthly: FormMoney;
  yearly: FormMoney;
  /** Off = no price per worker (null in the catalog); the amounts stay for switching back. */
  perWorkerOn: boolean;
  per_worker: FormMoney;
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

const moneyText = (money: Record<PriceCurrency, number> | null): FormMoney => ({
  CZK: text(money?.CZK),
  EUR: text(money?.EUR),
});

/** The cards in order, numbers as text. */
export function toForm(catalog: readonly CatalogPlan[]): FormPlan[] {
  return sortedPlans(catalog).map((plan) => ({
    key: plan.key,
    name: { ...plan.name },
    tagline: { ...plan.tagline },
    monthly: moneyText(plan.monthly),
    yearly: moneyText(plan.yearly),
    perWorkerOn: plan.per_worker !== null,
    per_worker: moneyText(plan.per_worker),
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

const moneyValue = (money: FormMoney) =>
  Object.fromEntries(
    PRICE_CURRENCIES.map((currency) => [currency, parseAmount(money[currency])]),
  ) as Record<PriceCurrency, number | null>;

/** The payload as it would be saved; the order is the order of the cards. */
export function fromForm(form: readonly FormPlan[]): PlanCatalog {
  return form.map((plan, order) => ({
    key: plan.key,
    name: { ...plan.name },
    tagline: { ...plan.tagline },
    monthly: moneyValue(plan.monthly),
    yearly: moneyValue(plan.yearly),
    per_worker: plan.perWorkerOn ? moneyValue(plan.per_worker) : null,
    limits: Object.fromEntries(
      PLAN_LIMIT_KEYS.map((limit) => [limit, parseAmount(plan.limits[limit])]),
    ),
    features: plan.features.map(({ cs, en, highlight }) => ({ cs, en, highlight })),
    recommended: plan.recommended,
    order,
  })) as PlanCatalog;
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
