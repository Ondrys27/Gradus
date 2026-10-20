import {
  catalogLocaleFor,
  CATALOG_LOCALES,
  OPTIONAL_LIMITS,
  PAID_PLAN_KEYS,
  PLAN_LIMIT_KEYS,
  PRICE_CURRENCIES,
  type Billing,
  type CatalogFeature,
  type CatalogPlan,
  type CatalogText,
  type Money,
  type PaidPlanKey,
  type PlanCatalog,
  type PlanLimitKey,
  type PlanLimits,
  type PriceCurrency,
} from "@/config/pricing";

/**
 * The plan catalog as data: validation of a version, the prices a card shows
 * and the difference between two versions. Shared by the website, the app,
 * the administration's editor and the server; the database checks the same
 * rules in valid_plan_catalog() (supabase/migrations/…_plan_catalog.sql).
 */

export const NAME_MAX = 40;
export const TAGLINE_MAX = 80;
export const FEATURE_MAX = 120;
export const MAX_FEATURES = 12;
export const MAX_PRICE = 1_000_000;
export const MAX_LIMIT = 1_000_000;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type CatalogIssueCode =
  | "required"
  | "tooLong"
  | "number"
  | "positive"
  | "decimals"
  | "integer"
  | "range"
  | "yearlyTooHigh"
  | "tooManyFeatures"
  | "keys"
  | "order"
  | "recommended"
  | "invalid";

/** `path` names the plan by key: "pro.monthly.CZK", "team.features.2.en", "catalog". */
export type CatalogIssue = { path: string; code: CatalogIssueCode };

export type CatalogValidation =
  | { ok: true; catalog: PlanCatalog }
  | { ok: false; issues: CatalogIssue[] };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

const PLAN_FIELDS = [
  "key",
  "name",
  "tagline",
  "monthly",
  "yearly",
  "per_worker",
  "limits",
  "features",
  "recommended",
  "order",
] as const;

/** Whole cents at most: 19, 19.9, 19.99. */
function hasCents(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

/**
 * Checks a catalog and returns it cleaned (texts trimmed, plans by order).
 * Exactly the plans solo, pro and team; prices positive with at most two
 * decimals and a year never more than twelve months; limits whole numbers
 * from 0 (workers and storage may be empty = no limit); names, taglines and
 * at most 12 lines per card in both languages; one recommended plan at most.
 */
export function validatePlanCatalog(input: unknown): CatalogValidation {
  const issues: CatalogIssue[] = [];
  const add = (path: string, code: CatalogIssueCode) => issues.push({ path, code });

  if (!Array.isArray(input) || input.length !== PAID_PLAN_KEYS.length) {
    return { ok: false, issues: [{ path: "catalog", code: "keys" }] };
  }
  const keys = input.map((plan) => (isObject(plan) ? plan.key : undefined));
  if (
    new Set(keys).size !== PAID_PLAN_KEYS.length ||
    !PAID_PLAN_KEYS.every((key) => keys.includes(key))
  ) {
    return { ok: false, issues: [{ path: "catalog", code: "keys" }] };
  }

  const plans: CatalogPlan[] = [];
  for (const raw of input as Record<string, unknown>[]) {
    const key = raw.key as PaidPlanKey;
    if (!hasOnlyKeys(raw, PLAN_FIELDS)) add(`${key}`, "invalid");

    const text = (field: "name" | "tagline", min: number, max: number): CatalogText => {
      const value = raw[field];
      const result = { cs: "", en: "" };
      for (const locale of CATALOG_LOCALES) {
        const item = isObject(value) ? value[locale] : undefined;
        if (typeof item !== "string") {
          add(`${key}.${field}.${locale}`, min > 0 ? "required" : "invalid");
          continue;
        }
        const trimmed = item.trim();
        if (trimmed.length < min) add(`${key}.${field}.${locale}`, "required");
        else if (trimmed.length > max) add(`${key}.${field}.${locale}`, "tooLong");
        result[locale] = trimmed;
      }
      if (isObject(value) && !hasOnlyKeys(value, CATALOG_LOCALES)) add(`${key}.${field}`, "invalid");
      return result;
    };

    const money = (field: "monthly" | "yearly" | "per_worker"): Money => {
      const value = raw[field];
      const result = { CZK: 0, EUR: 0 };
      if (!isObject(value) || !hasOnlyKeys(value, PRICE_CURRENCIES)) {
        add(`${key}.${field}`, "invalid");
        return result;
      }
      for (const currency of PRICE_CURRENCIES) {
        const amount = value[currency];
        const path = `${key}.${field}.${currency}`;
        if (amount === null || amount === undefined) add(path, "required");
        else if (typeof amount !== "number" || !Number.isFinite(amount)) add(path, "number");
        else if (amount <= 0) add(path, "positive");
        else if (amount > MAX_PRICE) add(path, "range");
        else if (!hasCents(amount)) add(path, "decimals");
        else result[currency] = amount;
      }
      return result;
    };

    const name = text("name", 1, NAME_MAX);
    const tagline = text("tagline", 0, TAGLINE_MAX);
    const monthly = money("monthly");
    const yearly = money("yearly");
    const perWorker = raw.per_worker === null ? null : money("per_worker");
    for (const currency of PRICE_CURRENCIES) {
      if (monthly[currency] > 0 && yearly[currency] > 12 * monthly[currency] + 1e-9) {
        add(`${key}.yearly.${currency}`, "yearlyTooHigh");
      }
    }

    const limits = { ...EMPTY_LIMITS };
    const rawLimits = raw.limits;
    if (!isObject(rawLimits) || !hasOnlyKeys(rawLimits, PLAN_LIMIT_KEYS)) {
      add(`${key}.limits`, "invalid");
    } else {
      for (const limit of PLAN_LIMIT_KEYS) {
        const value = rawLimits[limit];
        const path = `${key}.limits.${limit}`;
        if (value === null && OPTIONAL_LIMITS.includes(limit)) {
          (limits as Record<PlanLimitKey, number | null>)[limit] = null;
        } else if (typeof value !== "number" || !Number.isFinite(value)) {
          add(path, value === null || value === undefined ? "required" : "number");
        } else if (!Number.isInteger(value)) add(path, "integer");
        else if (value < 0 || value > MAX_LIMIT) add(path, "range");
        else (limits as Record<PlanLimitKey, number | null>)[limit] = value;
      }
    }

    const features: CatalogFeature[] = [];
    if (!Array.isArray(raw.features)) add(`${key}.features`, "invalid");
    else {
      if (raw.features.length > MAX_FEATURES) add(`${key}.features`, "tooManyFeatures");
      raw.features.forEach((feature: unknown, index) => {
        const path = `${key}.features.${index}`;
        if (!isObject(feature) || !hasOnlyKeys(feature, [...CATALOG_LOCALES, "highlight"])) {
          add(path, "invalid");
          return;
        }
        const line = { cs: "", en: "", highlight: feature.highlight === true };
        if (typeof feature.highlight !== "boolean") add(`${path}.highlight`, "invalid");
        for (const locale of CATALOG_LOCALES) {
          const item = feature[locale];
          const trimmed = typeof item === "string" ? item.trim() : "";
          if (!trimmed) add(`${path}.${locale}`, "required");
          else if (trimmed.length > FEATURE_MAX) add(`${path}.${locale}`, "tooLong");
          line[locale] = trimmed;
        }
        features.push(line);
      });
    }

    if (typeof raw.recommended !== "boolean") add(`${key}.recommended`, "invalid");
    const order = raw.order;
    if (typeof order !== "number" || !Number.isInteger(order) || order < 0 || order > 2) {
      add(`${key}.order`, "order");
    }

    plans.push({
      key,
      name,
      tagline,
      monthly,
      yearly,
      per_worker: perWorker,
      limits,
      features,
      recommended: raw.recommended === true,
      order: typeof order === "number" ? order : 0,
    });
  }

  if (new Set(plans.map((plan) => plan.order)).size !== plans.length) add("catalog", "order");
  if (plans.filter((plan) => plan.recommended).length > 1) add("catalog", "recommended");

  return issues.length ? { ok: false, issues } : { ok: true, catalog: sortedPlans(plans) };
}

const EMPTY_LIMITS: PlanLimits = {
  daily_contacts: 0,
  monthly_contacts: 0,
  ai_calls: 0,
  ai_files: 0,
  workers: null,
  storage_mb: null,
};

// ---------------------------------------------------------------------------
// What a card shows
// ---------------------------------------------------------------------------

export function sortedPlans(catalog: readonly CatalogPlan[]): PlanCatalog {
  return [...catalog].sort((a, b) => a.order - b.order);
}

/** A text of the catalog in the page's or the interface's language. */
export function planText(text: CatalogText, locale: string): string {
  return text[catalogLocaleFor(locale)];
}

/** The plan's name in a language; the key for a plan outside the catalog (beta). */
export function planName(catalog: readonly CatalogPlan[], key: string, locale: string): string | null {
  const plan = catalog.find((candidate) => candidate.key === key);
  return plan ? planText(plan.name, locale) : null;
}

/** Whole units when the monthly price is whole, else cents. */
function roundLike(base: number, value: number): number {
  return Number.isInteger(base) ? Math.round(value) : Math.round(value * 100) / 100;
}

/** The monthly amount for the chosen billing; yearly is the year's price spread over 12 months. */
export function monthlyPrice(plan: CatalogPlan, currency: PriceCurrency, billing: Billing): number {
  if (billing === "monthly") return plan.monthly[currency];
  return roundLike(plan.monthly[currency], plan.yearly[currency] / 12);
}

export function yearlyPrice(plan: CatalogPlan, currency: PriceCurrency): number {
  return plan.yearly[currency];
}

/**
 * The extra monthly price of one worker, or null for plans without workers.
 * Paid yearly, a worker gets the same discount as the plan.
 */
export function perWorkerPrice(
  plan: CatalogPlan,
  currency: PriceCurrency,
  billing: Billing,
): number | null {
  if (!plan.per_worker) return null;
  const price = plan.per_worker[currency];
  if (billing === "monthly") return price;
  return roundLike(price, (price * plan.yearly[currency]) / (12 * plan.monthly[currency]));
}

/**
 * Months free when paying for a year, if every plan gives the same whole
 * number of them in this currency; null otherwise (the badge is left out
 * rather than claim something untrue).
 */
export function yearlyMonthsFree(
  catalog: readonly CatalogPlan[],
  currency: PriceCurrency,
): number | null {
  let months: number | null = null;
  for (const plan of catalog) {
    const charged = plan.yearly[currency] / plan.monthly[currency];
    const free = 12 - charged;
    if (Math.abs(free - Math.round(free)) > 1e-9 || Math.round(free) < 1) return null;
    if (months !== null && months !== Math.round(free)) return null;
    months = Math.round(free);
  }
  return months;
}

/** Placeholders a line of a card may use, filled with the plan's limit. */
const PLACEHOLDER = new RegExp(`\\{(${PLAN_LIMIT_KEYS.join("|")})\\}`, "g");

/**
 * A line of a card in a language, with `{monthly_contacts}` and the other
 * limit names replaced by the plan's number (formatted by the caller; an
 * empty limit reads `unlimited`).
 */
export function featureText(
  feature: CatalogFeature,
  plan: CatalogPlan,
  locale: string,
  formatCount: (value: number) => string,
  unlimited: string,
): string {
  return planText(feature, locale).replace(PLACEHOLDER, (_, limit: PlanLimitKey) => {
    const value = plan.limits[limit];
    return value === null ? unlimited : formatCount(value);
  });
}

// ---------------------------------------------------------------------------
// Difference between two versions
// ---------------------------------------------------------------------------

export type ChangeValue = string | number | boolean | null | CatalogFeature[];

/**
 * One changed value of one plan. `field` is "name.cs", "monthly.EUR",
 * "per_worker.CZK", "limits.workers", "features", "recommended" or "order".
 */
export type CatalogChange = {
  plan: PaidPlanKey;
  field: string;
  from: ChangeValue;
  to: ChangeValue;
};

const sameFeatures = (a: CatalogFeature[], b: CatalogFeature[]) =>
  a.length === b.length &&
  a.every(
    (line, index) =>
      line.cs === b[index].cs && line.en === b[index].en && line.highlight === b[index].highlight,
  );

/** Every value that differs between two catalogs, plan by plan in the new order. */
export function diffPlanCatalogs(
  from: readonly CatalogPlan[],
  to: readonly CatalogPlan[],
): CatalogChange[] {
  const changes: CatalogChange[] = [];
  for (const next of sortedPlans(to)) {
    const prev = from.find((plan) => plan.key === next.key);
    if (!prev) continue;
    const push = (field: string, a: ChangeValue, b: ChangeValue) => {
      if (a !== b) changes.push({ plan: next.key, field, from: a, to: b });
    };
    for (const field of ["name", "tagline"] as const) {
      for (const locale of CATALOG_LOCALES) {
        push(`${field}.${locale}`, prev[field][locale], next[field][locale]);
      }
    }
    for (const field of ["monthly", "yearly", "per_worker"] as const) {
      for (const currency of PRICE_CURRENCIES) {
        push(`${field}.${currency}`, prev[field]?.[currency] ?? null, next[field]?.[currency] ?? null);
      }
    }
    for (const limit of PLAN_LIMIT_KEYS) {
      push(`limits.${limit}`, prev.limits[limit], next.limits[limit]);
    }
    if (!sameFeatures(prev.features, next.features)) {
      changes.push({ plan: next.key, field: "features", from: prev.features, to: next.features });
    }
    push("recommended", prev.recommended, next.recommended);
    push("order", prev.order, next.order);
  }
  return changes;
}

export type LoweredLimit = {
  plan: PaidPlanKey;
  limit: PlanLimitKey;
  from: number | null;
  to: number;
};

/** Limits the new version makes smaller (an empty limit is the largest). */
export function loweredLimits(
  from: readonly CatalogPlan[],
  to: readonly CatalogPlan[],
): LoweredLimit[] {
  const lowered: LoweredLimit[] = [];
  for (const next of sortedPlans(to)) {
    const prev = from.find((plan) => plan.key === next.key);
    if (!prev) continue;
    for (const limit of PLAN_LIMIT_KEYS) {
      const before = prev.limits[limit];
      const after = next.limits[limit];
      if (after !== null && (before === null || after < before)) {
        lowered.push({ plan: next.key, limit, from: before, to: after });
      }
    }
  }
  return lowered;
}
