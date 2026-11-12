import type { CatalogPlan, Money, PlanLimits } from "@/config/pricing";
import { featureText, moneyCurrencies, planName, planText, sortedPlans } from "@/features/plan/catalog";
import { localizePlan } from "@/features/plan/localized";
import type { RateTable } from "@/lib/exchange-rates";
import {
  displayStatus,
  nextPayment,
  periodEndOf,
  type Subscription,
} from "@/features/subscription/state";
import { APP_NAME } from "@/lib/constants";
import { todayIsoDate, type FormatSettings } from "@/lib/format";

const limit = (value: number | null) => (value === null ? "no limit" : String(value));
/** Card texts come from the administration; they stay plain text inside the block. */
const plain = (text: string) => text.replace(/[<>]/g, "");

function limitsLine(limits: PlanLimits): string {
  return [
    `${limits.daily_contacts} generated contacts a day and ${limits.monthly_contacts} a month`,
    `${limits.ai_calls} Grady answers and ${limits.ai_files} files for Grady a month`,
    `workers: ${limit(limits.workers)}`,
    `storage: ${limits.storage_mb === null ? "no limit" : `${limits.storage_mb} MB`}`,
    `active meeting types in the scheduler: ${limit(limits.scheduler_types)}`,
  ].join(", ");
}

/** "19 EUR or 490 CZK": EUR and every manual price of the catalog. */
const amounts = (money: Money) => moneyCurrencies(money).map((code) => `${money[code]} ${code}`).join(" or ");

/**
 * Grady's knowledge of the plans: the published catalog as a short block of
 * the chat context, card texts in the interface language. Read on every
 * chat, so a published change is what Grady says from the next message.
 * Prices are EUR and the manual ones; for a user whose currency has no
 * manual price, `local` adds the price at today's rate (shown, not charged).
 */
export function describePlans(
  plans: readonly CatalogPlan[],
  locale: string,
  /** What the user has, from describeSubscription(); left out when unknown. */
  own: string | null = null,
  local: { currency: string; rates: RateTable; now?: Date } | null = null,
): string {
  const lines = sortedPlans(plans).map((plan) => {
    const derived =
      local && typeof plan.monthly[local.currency] !== "number"
        ? localizePlan(plan, local.currency, local.rates, local.now)
        : null;
    const prices =
      `${amounts(plan.monthly)} a month, ` +
      `${amounts(plan.yearly)} a year` +
      (plan.included_workers > 0 ? `, ${plan.included_workers} workers in the price` : "") +
      (plan.per_worker
        ? `, plus ${amounts(plan.per_worker)} a month per ${plan.included_workers > 0 ? "further " : ""}worker`
        : "") +
      (derived && local
        ? ` (in ${local.currency} about ${derived.monthly[local.currency]} a month and ${derived.yearly[local.currency]} a year at today's rate; charged in EUR)`
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
    `The plans of ${APP_NAME} as published now, prices without VAT. For plans and prices use only these; the user compares, changes or cancels their plan in Settings → Subscription.`,
    "Workers: anyone with a valid plan of their own joins a company for free; the owner pays only for workers without one (the workers in the price first, then the price per worker). A worker's AI use in a company counts to that company's limits.",
    ...lines,
    ...(own ? [own] : []),
    "</plans>",
  ].join("\n");
}

/** The user is a worker: the plan is the workspace owner's, not theirs to manage. */
export const WORKER_SUBSCRIPTION_LINE =
  "The user's own plan: none to manage; they work in their owner's workspace, whose plan the owner handles.";

/**
 * What the user has now, for the <plans> block: the plan, the billing period
 * and the state with its dates in the user's zone (when the trial ends, when
 * a cancelled subscription stops), a scheduled change, a failed payment
 * Stripe is retrying (Grady reminds of it once in a conversation). Computed
 * from the row at the moment of the chat, never stored. A subscription that
 * does not run through Stripe is not charged.
 */
export function describeSubscription(
  sub: Subscription | null,
  plans: readonly CatalogPlan[],
  settings: FormatSettings,
  now: Date = new Date(),
): string | null {
  if (!sub) return null;
  const day = (at: string | null) => (at ? todayIsoDate(settings, new Date(at)) : "unknown");
  const name = (key: string) => plain(planName(plans, key, "en") ?? (key === "beta" ? "Beta" : key));
  const status = displayStatus(sub, now);
  if (status === "beta") {
    return "The user's own plan: the free beta, open-ended, no payment; plans start once payments go live.";
  }
  const end = periodEndOf(sub);
  const parts = [`The user's own plan: ${name(sub.planKey)}, billed ${sub.billing}.`];
  switch (status) {
    case "trialing": {
      const days = end ? Math.max(0, Math.ceil((Date.parse(end) - now.getTime()) / 86_400_000)) : null;
      parts.push(
        `Free trial until ${day(end)}${days === null ? "" : ` (${days} ${days === 1 ? "day" : "days"} left)`}; after it the workspace is read-only (nothing deleted) until a plan is active.`,
      );
      break;
    }
    case "ending":
      parts.push(`Cancelled by the user: it runs until ${day(end)}, then the workspace is read-only (nothing deleted); they can resume it until then.`);
      break;
    case "expired":
      parts.push(`Ended on ${day(end ?? sub.trialEndsAt)}: the workspace is read-only, the data is kept, until a plan is active again.`);
      break;
    case "pastDue":
      parts.push(
        "The last payment failed (past due): Stripe retries it over the next days and the app keeps working as before; if the last attempt fails too, the subscription ends and the workspace becomes read-only (nothing deleted) until they pay again. " +
          "Remind the user of it once in this conversation, not in every answer: they update the card in Settings → Subscription → Manage payment method and receipts.",
      );
      break;
    default:
      parts.push("Active.");
  }
  if (sub.scheduled && status !== "expired") {
    parts.push(`Scheduled change: ${name(sub.scheduled.planKey)}, billed ${sub.scheduled.billing}, from ${day(sub.scheduled.at)}.`);
  }
  const next = nextPayment(sub, now);
  if (sub.gateway === "stripe") {
    if (next) parts.push(`Next payment due ${day(next.at)}, charged to their card through Stripe.`);
  } else {
    parts.push(
      next
        ? `Next payment due ${day(next.at)}; payments are not live yet, so nothing is charged.`
        : "Payments are not live yet; nothing is charged.",
    );
  }
  return parts.join(" ");
}
