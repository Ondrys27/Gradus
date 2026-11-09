import {
  catalogLocaleFor,
  CATALOG_LOCALES,
  OPTIONAL_LIMITS,
  PAID_PLAN_KEYS,
  PLAN_LIMIT_KEYS,
  SCHEDULER_TYPES_DEFAULT,
  isAddOnKey,
  isPaidPlanKey,
  type AddOnKey,
  type Billing,
  type CatalogAddOn,
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
import { BASE_CURRENCY, currencyDigits, isCurrencyShape } from "@/lib/currency";

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
/** In any currency (KRW, VND and IDR count in hundreds of thousands). */
export const MAX_PRICE = 1_000_000_000;
/** Manual prices of one thing: EUR and up to 59 others. */
export const MAX_PRICE_CURRENCIES = 60;
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
  | "currencies"
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
  "included_workers",
  "limits",
  "features",
  "recommended",
  "order",
] as const;

/** At most the currency's decimals, never more than cents: 19, 19.9, 19.99; JPY 2990. */
export function hasCurrencyDecimals(value: number, currency: string): boolean {
  const factor = 10 ** Math.min(currencyDigits(currency), 2);
  return Math.abs(value * factor - Math.round(value * factor)) < 1e-6;
}

/** The currencies of a price, EUR first, then A–Z. */
export function moneyCurrencies(money: Money): string[] {
  return Object.keys(money).sort((a, b) =>
    a === BASE_CURRENCY ? -1 : b === BASE_CURRENCY ? 1 : a.localeCompare(b),
  );
}

/** The currencies with a manual price besides EUR. */
export function manualCurrencies(money: Money): string[] {
  return moneyCurrencies(money).filter((code) => code !== BASE_CURRENCY);
}

/** The currencies a price object names, valid amount or not (so one typo is one error). */
const namedCurrencies = (value: unknown): string =>
  isObject(value)
    ? Object.keys(value)
        .filter(isCurrencyShape)
        .sort()
        .join()
    : "";

const sameCurrencies = (a: unknown, b: unknown) => namedCurrencies(a) === namedCurrencies(b);

/**
 * Checks one price object: EUR always, other three-letter codes at will,
 * each amount above 0, at most MAX_PRICE and with at most the currency's
 * decimals (none for JPY). Same as plan_catalog_money_ok() in the database.
 */
export function validateMoney(
  value: unknown,
  path: string,
  add: (path: string, code: CatalogIssueCode) => void,
): Money {
  const result: Money = { EUR: 0 };
  if (!isObject(value) || Object.keys(value).length > MAX_PRICE_CURRENCIES) {
    add(path, "invalid");
    return result;
  }
  if (!(BASE_CURRENCY in value)) add(`${path}.${BASE_CURRENCY}`, "required");
  for (const [currency, amount] of Object.entries(value)) {
    const at = `${path}.${currency}`;
    if (!isCurrencyShape(currency)) add(path, "invalid");
    else if (amount === null || amount === undefined) add(at, "required");
    else if (typeof amount !== "number" || !Number.isFinite(amount)) add(at, "number");
    else if (amount <= 0) add(at, "positive");
    else if (amount > MAX_PRICE) add(at, "range");
    else if (!hasCurrencyDecimals(amount, currency)) add(at, "decimals");
    else result[currency] = amount;
  }
  return result;
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

    const money = (field: "monthly" | "yearly" | "per_worker"): Money =>
      validateMoney(raw[field], `${key}.${field}`, add);

    const name = text("name", 1, NAME_MAX);
    const tagline = text("tagline", 0, TAGLINE_MAX);
    const monthly = money("monthly");
    const yearly = money("yearly");
    const perWorker = raw.per_worker === null ? null : money("per_worker");
    // Optional: versions published before step 22.5 have none in the price.
    let includedWorkers = 0;
    if (raw.included_workers !== undefined) {
      const value = raw.included_workers;
      const path = `${key}.included_workers`;
      if (typeof value !== "number" || !Number.isFinite(value)) add(path, "number");
      else if (!Number.isInteger(value)) add(path, "integer");
      else if (value < 0 || value > MAX_LIMIT) add(path, "range");
      else includedWorkers = value;
    }
    // A manual price in a currency is the month, the year and (if any) the worker.
    if (!sameCurrencies(raw.monthly, raw.yearly)) add(`${key}.yearly`, "currencies");
    if (perWorker && !sameCurrencies(raw.monthly, raw.per_worker)) add(`${key}.per_worker`, "currencies");
    for (const currency of moneyCurrencies(monthly)) {
      const year = yearly[currency];
      if (monthly[currency] > 0 && year !== undefined && year > 12 * monthly[currency] + 1e-9) {
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
        // Versions published before 24.3 have no scheduler limit: the default of the plan.
        if (limit === "scheduler_types" && value === undefined) {
          limits.scheduler_types = isPaidPlanKey(key) ? SCHEDULER_TYPES_DEFAULT[key] : null;
        } else if (value === null && OPTIONAL_LIMITS.includes(limit)) {
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
      included_workers: includedWorkers,
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

export const ADD_ON_NAME_MAX = 40;
export const ADD_ON_DESCRIPTION_MAX = 160;
const ADD_ON_FIELDS = ["key", "name", "description", "monthly", "order"] as const;

export type AddOnsValidation =
  | { ok: true; addOns: CatalogAddOn[] }
  | { ok: false; issues: CatalogIssue[] };

/**
 * Checks the add-ons of a version: each known key once (ADD_ON_KEYS), a name
 * (1–40) and a description (0–160) in both languages, a monthly price like a
 * plan's and an order 0–9. Same as valid_plan_add_ons() in the database.
 * Issues name the add-on by key: "no_branding.monthly.EUR".
 */
export function validatePlanAddOns(input: unknown): AddOnsValidation {
  const issues: CatalogIssue[] = [];
  const add = (path: string, code: CatalogIssueCode) => issues.push({ path, code });
  if (!Array.isArray(input) || input.length > 10) return { ok: false, issues: [{ path: "addOns", code: "invalid" }] };
  const addOns: CatalogAddOn[] = [];
  const seen = new Set<string>();
  for (const raw of input as unknown[]) {
    if (!isObject(raw) || !isAddOnKey(raw.key) || seen.has(raw.key)) {
      add("addOns", "keys");
      continue;
    }
    const key = raw.key;
    seen.add(key);
    if (!hasOnlyKeys(raw, ADD_ON_FIELDS)) add(key, "invalid");
    const text = (field: "name" | "description", min: number, max: number): CatalogText => {
      const value = raw[field];
      const result = { cs: "", en: "" };
      if (!isObject(value) || !hasOnlyKeys(value, CATALOG_LOCALES)) add(`${key}.${field}`, "invalid");
      for (const locale of CATALOG_LOCALES) {
        const item = isObject(value) ? value[locale] : undefined;
        const trimmed = typeof item === "string" ? item.trim() : "";
        if (typeof item !== "string" || trimmed.length < min) add(`${key}.${field}.${locale}`, "required");
        else if (trimmed.length > max) add(`${key}.${field}.${locale}`, "tooLong");
        result[locale] = trimmed;
      }
      return result;
    };
    const order = raw.order;
    if (typeof order !== "number" || !Number.isInteger(order) || order < 0 || order > 9) {
      add(`${key}.order`, "order");
    }
    addOns.push({
      key,
      name: text("name", 1, ADD_ON_NAME_MAX),
      description: text("description", 0, ADD_ON_DESCRIPTION_MAX),
      monthly: validateMoney(raw.monthly, `${key}.monthly`, add),
      order: typeof order === "number" ? order : 0,
    });
  }
  return issues.length
    ? { ok: false, issues }
    : { ok: true, addOns: [...addOns].sort((a, b) => a.order - b.order) };
}

const EMPTY_LIMITS: PlanLimits = {
  daily_contacts: 0,
  monthly_contacts: 0,
  ai_calls: 0,
  ai_files: 0,
  workers: null,
  storage_mb: null,
  scheduler_types: null,
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
 * "per_worker.CZK", "included_workers", "limits.workers", "features", "recommended" or "order".
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
      const currencies = new Set([
        ...moneyCurrencies(prev[field] ?? { EUR: 0 }),
        ...moneyCurrencies(next[field] ?? { EUR: 0 }),
      ]);
      for (const currency of currencies) {
        push(`${field}.${currency}`, prev[field]?.[currency] ?? null, next[field]?.[currency] ?? null);
      }
    }
    push("included_workers", prev.included_workers, next.included_workers);
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

/** One changed value of an add-on: "name.cs", "description.en", "monthly.EUR"… */
export type AddOnChange = { addOn: AddOnKey; field: string; from: string | number | null; to: string | number | null };

/** Every value that differs between the add-ons of two versions (an add-on only in one: every field). */
export function diffAddOns(from: readonly CatalogAddOn[], to: readonly CatalogAddOn[]): AddOnChange[] {
  const changes: AddOnChange[] = [];
  const keys = [...new Set([...to.map((addOn) => addOn.key), ...from.map((addOn) => addOn.key)])];
  for (const key of keys) {
    const prev = from.find((addOn) => addOn.key === key);
    const next = to.find((addOn) => addOn.key === key);
    const push = (field: string, a: string | number | null, b: string | number | null) => {
      if (a !== b) changes.push({ addOn: key, field, from: a, to: b });
    };
    for (const field of ["name", "description"] as const) {
      for (const locale of CATALOG_LOCALES) {
        push(`${field}.${locale}`, prev?.[field][locale] ?? null, next?.[field][locale] ?? null);
      }
    }
    const currencies = new Set([
      ...moneyCurrencies(prev?.monthly ?? { EUR: 0 }),
      ...moneyCurrencies(next?.monthly ?? { EUR: 0 }),
    ]);
    for (const currency of currencies) {
      push(`monthly.${currency}`, prev?.monthly[currency] ?? null, next?.monthly[currency] ?? null);
    }
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
