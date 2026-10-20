import type { CatalogPlan, PlanLimits } from "@/config/pricing";
import { featureText, planText, sortedPlans } from "@/features/plan/catalog";
import { APP_NAME } from "@/lib/constants";

const limit = (value: number | null) => (value === null ? "no limit" : String(value));
/** Card texts come from the administration; they stay plain text inside the block. */
const plain = (text: string) => text.replace(/[<>]/g, "");

function limitsLine(limits: PlanLimits): string {
  return [
    `${limits.daily_contacts} generated contacts a day and ${limits.monthly_contacts} a month`,
    `${limits.ai_calls} Jarvis answers and ${limits.ai_files} files for Jarvis a month`,
    `workers: ${limit(limits.workers)}`,
    `storage: ${limits.storage_mb === null ? "no limit" : `${limits.storage_mb} MB`}`,
  ].join(", ");
}

/**
 * Jarvis's knowledge of the plans: the published catalog as a short block of
 * the chat context, card texts in the interface language. Read on every
 * chat, so a published change is what Jarvis says from the next message.
 */
export function describePlans(plans: readonly CatalogPlan[], locale: string): string {
  const lines = sortedPlans(plans).map((plan) => {
    const prices =
      `${plan.monthly.CZK} CZK or ${plan.monthly.EUR} EUR a month, ` +
      `${plan.yearly.CZK} CZK or ${plan.yearly.EUR} EUR a year` +
      (plan.per_worker
        ? `, plus ${plan.per_worker.CZK} CZK or ${plan.per_worker.EUR} EUR a month per worker`
        : "");
    const card = plan.features
      .map((feature) => plain(featureText(feature, plan, locale, String, "no limit")))
      .join("; ");
    return (
      `- ${plain(planText(plan.name, locale))}${plan.recommended ? " (recommended)" : ""}: ${prices}. ` +
      `Limits: ${limitsLine(plan.limits)}.` +
      (card ? ` On the card: ${card}.` : "")
    );
  });
  return [
    "<plans>",
    `The plans of ${APP_NAME} as published now, prices without VAT. For plans and prices use only these; the user compares them and says they are interested on the Plan page.`,
    ...lines,
    "</plans>",
  ].join("\n");
}
