/**
 * Prices and limits of the plans in one place: the public pricing page, the
 * plan page in the app and the trial read them from here. The database keeps
 * the same monthly contact limits in `plans` (checked by a test), because the
 * server enforces them there.
 *
 * Prices are without VAT, per month. Czech visitors see CZK, everyone else EUR.
 */

/** Length of the free trial after a sign-up without an invite. */
export const TRIAL_DAYS = 14;
/** From this many days left the trial bar turns more visible. */
export const TRIAL_URGENT_DAYS = 3;
/** Paying for a year costs this many months: two months free. */
export const YEARLY_MONTHS_CHARGED = 10;

export type PaidPlanKey = "solo" | "pro" | "team";
export type PriceCurrency = "CZK" | "EUR";

/** Translation keys under `pricing.features`. */
export type PlanFeature =
  | "allSections"
  | "jarvis"
  | "generatedContacts"
  | "meetingAnalysis"
  | "jarvisFiles"
  | "calendarSync"
  | "prioritySupport"
  | "everythingInPro"
  | "workers"
  | "rewards"
  | "teamStats";

export type PaidPlan = {
  key: PaidPlanKey;
  /** Monthly price per currency. */
  monthly: Record<PriceCurrency, number>;
  /** Extra monthly price per worker (Team only). */
  perWorker?: Record<PriceCurrency, number>;
  /** Generated contacts per month; the same number lives in `plans.monthly_generation_limit`. */
  monthlyContacts: number;
  recommended?: boolean;
  features: readonly PlanFeature[];
};

export const PAID_PLANS: readonly PaidPlan[] = [
  {
    key: "solo",
    monthly: { CZK: 490, EUR: 19 },
    monthlyContacts: 100,
    features: ["allSections", "generatedContacts", "jarvis"],
  },
  {
    key: "pro",
    monthly: { CZK: 890, EUR: 35 },
    monthlyContacts: 300,
    recommended: true,
    features: [
      "generatedContacts",
      "meetingAnalysis",
      "jarvisFiles",
      "calendarSync",
      "prioritySupport",
    ],
  },
  {
    key: "team",
    monthly: { CZK: 890, EUR: 35 },
    perWorker: { CZK: 290, EUR: 12 },
    monthlyContacts: 300,
    features: ["everythingInPro", "workers", "rewards", "teamStats"],
  },
];

/** The plan a sign-up from the website tries for free. */
export const TRIAL_PLAN_KEY: PaidPlanKey = "pro";

export function isPaidPlanKey(value: unknown): value is PaidPlanKey {
  return PAID_PLANS.some((plan) => plan.key === value);
}

/** CZK for Czech, EUR for every other language or currency. */
export function priceCurrencyFor(localeOrCurrency: string | null | undefined): PriceCurrency {
  return localeOrCurrency === "cs" || localeOrCurrency === "CZK" ? "CZK" : "EUR";
}

export type Billing = "monthly" | "yearly";

/** A monthly amount for the chosen billing; yearly is the year's price spread over 12 months. */
function perMonth(base: number, billing: Billing): number {
  return billing === "yearly" ? Math.round((base * YEARLY_MONTHS_CHARGED) / 12) : base;
}

export function monthlyPrice(plan: PaidPlan, currency: PriceCurrency, billing: Billing): number {
  return perMonth(plan.monthly[currency], billing);
}

/** The extra monthly price of one worker, or null for plans without workers. */
export function perWorkerPrice(
  plan: PaidPlan,
  currency: PriceCurrency,
  billing: Billing,
): number | null {
  return plan.perWorker ? perMonth(plan.perWorker[currency], billing) : null;
}

export function yearlyPrice(plan: PaidPlan, currency: PriceCurrency): number {
  return plan.monthly[currency] * YEARLY_MONTHS_CHARGED;
}
