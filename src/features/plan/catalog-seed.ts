import {
  ADD_ON_KEYS,
  ADD_ON_SEED_PRICES,
  PAID_PLANS,
  YEARLY_MONTHS_CHARGED,
  type CatalogAddOn,
  type Money,
  type PlanCatalog,
} from "@/config/pricing";
import { APP_NAME } from "@/lib/constants";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";

/**
 * The catalog built from src/config/pricing.ts and the plan texts of the
 * translations: what the first migration published (a test compares them)
 * and what the server shows when the database cannot be read. Server only:
 * it carries both translation files.
 */
export function seedPlanCatalog(): PlanCatalog {
  // The old card filled {count} with the monthly contacts; the catalog names the limit.
  const line = (text: string) => text.replace("{count}", "{monthly_contacts}");
  return PAID_PLANS.map((plan, order) => ({
    key: plan.key,
    name: { cs: cs.plans.names[plan.key], en: en.plans.names[plan.key] },
    tagline: { cs: cs.plans.taglines[plan.key], en: en.plans.taglines[plan.key] },
    monthly: { ...plan.monthly },
    yearly: times(plan.monthly, YEARLY_MONTHS_CHARGED),
    per_worker: plan.perWorker ? { ...plan.perWorker } : null,
    // The first version had no workers in the price: each one was extra.
    included_workers: 0,
    limits: { ...plan.limits },
    features: plan.features.map((feature) => ({
      cs: line(cs.plans.features[feature]),
      en: line(en.plans.features[feature]),
      highlight: false,
    })),
    recommended: plan.recommended === true,
    order,
  }));
}

/** The catalog stores plain text: the app's name goes in once, here. */
const withAppName = (text: string) => text.replaceAll("{appName}", APP_NAME);

const times = (money: Money, factor: number): Money =>
  Object.fromEntries(Object.entries(money).map(([code, amount]) => [code, amount * factor])) as Money;

/**
 * The add-ons of a version published before step 24.1 (it has none stored):
 * the seed prices with the names and descriptions of the translations.
 */
export function seedAddOns(): CatalogAddOn[] {
  return ADD_ON_KEYS.map((key, order) => ({
    key,
    name: { cs: withAppName(cs.plans.addOns[key].name), en: withAppName(en.plans.addOns[key].name) },
    description: {
      cs: withAppName(cs.plans.addOns[key].description),
      en: withAppName(en.plans.addOns[key].description),
    },
    monthly: { ...ADD_ON_SEED_PRICES[key] },
    order,
  }));
}
