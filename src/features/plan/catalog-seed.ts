import { PAID_PLANS, YEARLY_MONTHS_CHARGED, type PlanCatalog } from "@/config/pricing";
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
    yearly: {
      CZK: plan.monthly.CZK * YEARLY_MONTHS_CHARGED,
      EUR: plan.monthly.EUR * YEARLY_MONTHS_CHARGED,
    },
    per_worker: plan.perWorker ? { ...plan.perWorker } : null,
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
