import type { IsoDate } from "@/lib/format";
import { SEGMENT_VALUES, daysBetween, shiftDay, type Segment } from "@/lib/analytics/metrics";
import type { MetricParams } from "@/lib/analytics/metrics-plan";

/**
 * The shared controls of the administration live in the address, so a view
 * can be bookmarked: period, comparison, segment and internal accounts.
 * Anything unknown or malformed in the address falls back to the default.
 */

export const ADMIN_PERIODS = ["today", "7d", "30d", "90d", "12m", "custom"] as const;
export type AdminPeriod = (typeof ADMIN_PERIODS)[number];
export const DEFAULT_PERIOD: AdminPeriod = "30d";

/** The segments the controls offer (the registry also knows the sign-up week). */
export const ADMIN_SEGMENT_KEYS = [
  "plan",
  "mode",
  "industry",
  "locale",
  "country",
  "role",
  "device",
] as const;
export type AdminSegmentKey = (typeof ADMIN_SEGMENT_KEYS)[number];

/** The longest custom range; the database refuses more than 800 days. */
export const MAX_RANGE_DAYS = 400;

/** How often the open administration reloads its numbers. */
export const ADMIN_REFRESH_MS = 5 * 60_000;

export type AdminView = {
  period: AdminPeriod;
  /** Only for the custom period. */
  from: IsoDate | null;
  to: IsoDate | null;
  compare: boolean;
  internal: boolean;
  segment: Partial<Record<AdminSegmentKey, string>>;
};

export type DateRange = { from: IsoDate; to: IsoDate };

export const DEFAULT_VIEW: AdminView = {
  period: DEFAULT_PERIOD,
  from: null,
  to: null,
  compare: true,
  internal: false,
  segment: {},
};

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

function first(params: RawParams, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string | undefined | null): value is IsoDate {
  if (!value || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const OPEN_SEGMENT_PATTERN: Record<"industry" | "country", RegExp> = {
  industry: /^[A-Za-z0-9_-]{1,40}$/,
  country: /^[A-Z]{2}$/,
};

/** Whether a value may stand in the address for a segment. */
export function isSegmentValue(key: AdminSegmentKey, value: string): boolean {
  if (key === "industry" || key === "country") return OPEN_SEGMENT_PATTERN[key].test(value);
  return (SEGMENT_VALUES[key] as readonly string[]).includes(value);
}

export function parseAdminView(params: RawParams): AdminView {
  const rawPeriod = first(params, "period");
  let period = (ADMIN_PERIODS as readonly string[]).includes(rawPeriod ?? "")
    ? (rawPeriod as AdminPeriod)
    : DEFAULT_PERIOD;
  let from: IsoDate | null = null;
  let to: IsoDate | null = null;
  if (period === "custom") {
    const rawFrom = first(params, "from");
    const rawTo = first(params, "to");
    if (isIsoDate(rawFrom) && isIsoDate(rawTo) && rawFrom <= rawTo) {
      from = rawFrom;
      to = rawTo;
    } else {
      period = DEFAULT_PERIOD;
    }
  }
  const segment: AdminView["segment"] = {};
  for (const key of ADMIN_SEGMENT_KEYS) {
    const value = first(params, key);
    if (value && isSegmentValue(key, value)) segment[key] = value;
  }
  return {
    period,
    from,
    to,
    compare: first(params, "cmp") !== "0",
    internal: first(params, "internal") === "1",
    segment,
  };
}

/** The address query of a view; defaults are left out so plain links stay short. */
export function serializeAdminView(view: AdminView): URLSearchParams {
  const params = new URLSearchParams();
  if (view.period !== DEFAULT_PERIOD) params.set("period", view.period);
  if (view.period === "custom" && view.from && view.to) {
    params.set("from", view.from);
    params.set("to", view.to);
  }
  if (!view.compare) params.set("cmp", "0");
  if (view.internal) params.set("internal", "1");
  for (const key of ADMIN_SEGMENT_KEYS) {
    const value = view.segment[key];
    if (value) params.set(key, value);
  }
  return params;
}

export function viewQuery(view: AdminView): string {
  const query = serializeAdminView(view).toString();
  return query ? `?${query}` : "";
}

const PERIOD_DAYS: Record<Exclude<AdminPeriod, "custom">, number> = {
  today: 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "12m": 365,
};

/** The days a view covers, ending today at the latest. */
export function resolveRange(view: AdminView, today: IsoDate): DateRange {
  if (view.period === "custom" && view.from && view.to) {
    const to = view.to > today ? today : view.to;
    let from = view.from > to ? to : view.from;
    if (daysBetween(from, to).length > MAX_RANGE_DAYS) from = shiftDay(to, -(MAX_RANGE_DAYS - 1));
    return { from, to };
  }
  const period = view.period === "custom" ? "30d" : view.period;
  const days = PERIOD_DAYS[period];
  return { from: shiftDay(today, -(days - 1)), to: today };
}

/** The period of the same length right before. */
export function previousRange(range: DateRange): DateRange {
  const length = daysBetween(range.from, range.to).length;
  return { from: shiftDay(range.from, -length), to: shiftDay(range.from, -1) };
}

export function rangeLength(range: DateRange): number {
  return daysBetween(range.from, range.to).length;
}

/** What the metric functions get for a view and a range. */
export function metricParams(view: AdminView, range: DateRange): MetricParams {
  const segment: Segment = { ...view.segment };
  return { from: range.from, to: range.to, includeInternal: view.internal, segment };
}

/** A stable text of everything that changes the numbers, to key loading states. */
export function viewKey(view: AdminView, range: DateRange): string {
  return `${range.from}:${range.to}:${serializeAdminView(view).toString()}`;
}
