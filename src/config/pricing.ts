/**
 * The types of the plan catalog and its default seed. The prices, limits and
 * texts in force live in the database (`plan_catalog_versions`, the published
 * row), edited and published in the administration (Settings → Plans) and
 * read through getPublishedPlans() (src/features/plan/catalog-server.ts).
 *
 * PAID_PLANS is only the seed: the first migration published exactly this
 * (with the texts from the translations, see catalog-seed.ts), and the server
 * falls back to it when the database cannot be read. Changing it changes
 * nothing on the website.
 *
 * Prices are without VAT. Czech visitors see CZK, everyone else EUR.
 */

/** Length of the free trial after a sign-up without an invite. */
export const TRIAL_DAYS = 14;
/** From this many days left the trial bar turns more visible. */
export const TRIAL_URGENT_DAYS = 3;
/** The seed's yearly price is this many monthly prices: two months free. */
export const YEARLY_MONTHS_CHARGED = 10;

export const PAID_PLAN_KEYS = ["solo", "pro", "team"] as const;
export type PaidPlanKey = (typeof PAID_PLAN_KEYS)[number];
export const PRICE_CURRENCIES = ["CZK", "EUR"] as const;
export type PriceCurrency = (typeof PRICE_CURRENCIES)[number];
export type Billing = "monthly" | "yearly";

/** The two languages every text of the catalog has. */
export const CATALOG_LOCALES = ["cs", "en"] as const;
export type CatalogLocale = (typeof CATALOG_LOCALES)[number];
export type CatalogText = Record<CatalogLocale, string>;
export type Money = Record<PriceCurrency, number>;

/**
 * Limits of a plan. The four counts are what current_plan() enforces (the
 * contacts per day and per calendar month, Jarvis's answers and files per
 * month); workers and storage are what an account holds, null = no limit.
 */
export type PlanLimits = {
  daily_contacts: number;
  monthly_contacts: number;
  ai_calls: number;
  ai_files: number;
  workers: number | null;
  storage_mb: number | null;
};
export const PLAN_LIMIT_KEYS = [
  "daily_contacts",
  "monthly_contacts",
  "ai_calls",
  "ai_files",
  "workers",
  "storage_mb",
] as const satisfies readonly (keyof PlanLimits)[];
export type PlanLimitKey = (typeof PLAN_LIMIT_KEYS)[number];
/** The limits that may be empty (no limit). */
export const OPTIONAL_LIMITS: readonly PlanLimitKey[] = ["workers", "storage_mb"];

/** One line of a plan card; `highlight` makes it stand out. */
export type CatalogFeature = CatalogText & { highlight: boolean };

/** One plan as the published catalog stores it (snake_case, like the SQL that reads it). */
export type CatalogPlan = {
  key: PaidPlanKey;
  name: CatalogText;
  tagline: CatalogText;
  monthly: Money;
  /** The price of a whole year. */
  yearly: Money;
  /** Extra monthly price of one worker; null for plans without it. */
  per_worker: Money | null;
  limits: PlanLimits;
  features: CatalogFeature[];
  /** The "recommended" badge; at most one plan has it. */
  recommended: boolean;
  /** Position of the card, 0 first. */
  order: number;
};

/** The payload of a catalog version: the three plans. */
export type PlanCatalog = CatalogPlan[];

/** Translation keys under `plans.features`, used only to build the seed's texts. */
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
  /** Monthly price per currency; the seed's yearly price is YEARLY_MONTHS_CHARGED of these. */
  monthly: Money;
  /** Extra monthly price per worker (Team only). */
  perWorker?: Money;
  limits: PlanLimits;
  recommended?: boolean;
  features: readonly PlanFeature[];
};

/** The seed of the catalog; the same limits are in `plans` (checked by a test). */
export const PAID_PLANS: readonly PaidPlan[] = [
  {
    key: "solo",
    monthly: { CZK: 490, EUR: 19 },
    limits: {
      daily_contacts: 30,
      monthly_contacts: 100,
      ai_calls: 300,
      ai_files: 0,
      workers: null,
      storage_mb: null,
    },
    features: ["allSections", "generatedContacts", "jarvis"],
  },
  {
    key: "pro",
    monthly: { CZK: 890, EUR: 35 },
    limits: {
      daily_contacts: 100,
      monthly_contacts: 300,
      ai_calls: 1000,
      ai_files: 100,
      workers: null,
      storage_mb: null,
    },
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
    limits: {
      daily_contacts: 100,
      monthly_contacts: 300,
      ai_calls: 1500,
      ai_files: 150,
      workers: null,
      storage_mb: null,
    },
    features: ["everythingInPro", "workers", "rewards", "teamStats"],
  },
];

/** The plan a sign-up from the website tries for free. */
export const TRIAL_PLAN_KEY: PaidPlanKey = "pro";

export function isPaidPlanKey(value: unknown): value is PaidPlanKey {
  return (PAID_PLAN_KEYS as readonly unknown[]).includes(value);
}

/** CZK for Czech, EUR for every other language or currency. */
export function priceCurrencyFor(localeOrCurrency: string | null | undefined): PriceCurrency {
  return localeOrCurrency === "cs" || localeOrCurrency === "CZK" ? "CZK" : "EUR";
}

/** The catalog's text language for an interface or page locale (Czech or English). */
export function catalogLocaleFor(locale: string | null | undefined): CatalogLocale {
  return locale === "cs" ? "cs" : "en";
}
