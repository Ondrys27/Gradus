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
 * Prices are without VAT. Every price is set in EUR; the owner may add a
 * manual price in any other currency (CZK in the seed). Every other currency
 * is derived from EUR at the day's rate and rounded to a selling price
 * (src/features/plan/localized.ts), so a visitor sees their own currency.
 */

/** Length of the free trial after a sign-up without an invite. */
export const TRIAL_DAYS = 14;
/** From this many days left the trial bar turns more visible. */
export const TRIAL_URGENT_DAYS = 3;
/** The seed's yearly price is this many monthly prices: two months free. */
export const YEARLY_MONTHS_CHARGED = 10;

export const PAID_PLAN_KEYS = ["solo", "pro", "team"] as const;
export type PaidPlanKey = (typeof PAID_PLAN_KEYS)[number];
/** An ISO 4217 code a price is shown or charged in. */
export type PriceCurrency = string;
export type Billing = "monthly" | "yearly";

/** The two languages every text of the catalog has. */
export const CATALOG_LOCALES = ["cs", "en"] as const;
export type CatalogLocale = (typeof CATALOG_LOCALES)[number];
export type CatalogText = Record<CatalogLocale, string>;
/**
 * The prices of one thing: always EUR (BASE_CURRENCY), plus the manual
 * prices the owner set for other currencies. A currency missing here is
 * derived from EUR when shown.
 */
export type Money = { EUR: number } & Record<PriceCurrency, number>;

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
  /**
   * Active meeting types of the scheduler per person (24.3); null = no limit.
   * Versions published before 24.3 lack it and read as SCHEDULER_TYPES_DEFAULT.
   */
  scheduler_types: number | null;
};
export const PLAN_LIMIT_KEYS = [
  "daily_contacts",
  "monthly_contacts",
  "ai_calls",
  "ai_files",
  "workers",
  "storage_mb",
  "scheduler_types",
] as const satisfies readonly (keyof PlanLimits)[];
export type PlanLimitKey = (typeof PLAN_LIMIT_KEYS)[number];
/** The limits that may be empty (no limit). */
export const OPTIONAL_LIMITS: readonly PlanLimitKey[] = [
  "workers",
  "storage_mb",
  "scheduler_types",
];
/**
 * The scheduler limit of a catalog version that has none (published before
 * 24.3); the same as plans.scheduler_types_limit, which the database reads then.
 */
export const SCHEDULER_TYPES_DEFAULT: Record<PaidPlanKey, number | null> = {
  solo: 1,
  pro: null,
  team: null,
};

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
  /**
   * The price per extra worker (price_per_extra_worker): the monthly price of
   * each worker beyond `included_workers` who has no plan of their own; null
   * for plans that take no extra workers.
   */
  per_worker: Money | null;
  /**
   * Workers without a plan of their own that the price covers (0 = every one
   * is extra). Versions published before step 22.5 lack it and read as 0.
   */
  included_workers: number;
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
      scheduler_types: 1,
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
      scheduler_types: null,
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
      scheduler_types: null,
    },
    features: ["everythingInPro", "workers", "rewards", "teamStats"],
  },
];

/** The plan a sign-up from the website tries for free. */
export const TRIAL_PLAN_KEY: PaidPlanKey = "pro";

export function isPaidPlanKey(value: unknown): value is PaidPlanKey {
  return (PAID_PLAN_KEYS as readonly unknown[]).includes(value);
}

// ---------------------------------------------------------------------------
// Add-ons (step 24.1): extras on top of any plan, in the catalog next to the plans.
// ---------------------------------------------------------------------------

/** The add-ons the code knows; the same list is add_on_keys() in the database. */
export const ADD_ON_KEYS = ["no_branding"] as const;
export type AddOnKey = (typeof ADD_ON_KEYS)[number];

export function isAddOnKey(value: unknown): value is AddOnKey {
  return (ADD_ON_KEYS as readonly unknown[]).includes(value);
}

/** One add-on of a catalog version (plan_catalog_versions.add_ons). */
export type CatalogAddOn = {
  key: AddOnKey;
  name: CatalogText;
  description: CatalogText;
  /** The monthly price; paid yearly it is twelve of them. */
  monthly: Money;
  /** Position in the list, 0 first. */
  order: number;
};

/**
 * The seed of the add-ons: "Without Gradus branding" for 0,99 € a month,
 * 29 Kč by hand; every other currency is derived (USD 1,19, GBP 0,89…).
 * Versions published before step 24.1 have no add-ons and read as this.
 */
export const ADD_ON_SEED_PRICES: Record<AddOnKey, Money> = {
  no_branding: { EUR: 0.99, CZK: 29 },
};

/** The catalog's text language for an interface or page locale (Czech or English). */
export function catalogLocaleFor(locale: string | null | undefined): CatalogLocale {
  return locale === "cs" ? "cs" : "en";
}
