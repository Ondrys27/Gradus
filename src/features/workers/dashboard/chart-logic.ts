import { addMonths, differenceInCalendarDays } from "date-fns";
import { shiftIsoDate, weekStartOf } from "@/features/crm-tasks/logic";
import {
  instantToZonedParts,
  isoDateToLocal,
  localToIsoDate,
  todayIsoDate,
  type FormatSettings,
  type IsoDate,
} from "@/lib/format";
import { outcomeDay, taskOutcome, type WorkTask } from "./outcome";

/**
 * The charts of a person's dashboard: a horizon ending today in the user's
 * zone, cut into days, weeks (by the user's week start) or months, and the
 * tasks and deals counted into those buckets. Pure, so Vitest covers it.
 */

export const HORIZONS = ["week", "month", "quarter", "year", "custom"] as const;
export type HorizonKind = (typeof HORIZONS)[number];
export type Horizon =
  { kind: Exclude<HorizonKind, "custom"> } | { kind: "custom"; from: IsoDate; to: IsoDate };

export type BucketUnit = "day" | "week" | "month";
export type DateRange = { from: IsoDate; to: IsoDate };

/** A custom range longer than this is cut (ten years of months is plenty). */
const CUSTOM_MAX_DAYS = 3660;

function monthStart(day: IsoDate): IsoDate {
  return `${day.slice(0, 7)}-01`;
}

function shiftMonths(day: IsoDate, months: number): IsoDate {
  return localToIsoDate(addMonths(isoDateToLocal(day), months));
}

export function daysBetween(range: DateRange): number {
  return differenceInCalendarDays(isoDateToLocal(range.to), isoDateToLocal(range.from)) + 1;
}

/** The days a horizon covers, both ends included. */
export function horizonRange(
  horizon: Horizon,
  today: IsoDate,
  settings: FormatSettings,
): DateRange {
  switch (horizon.kind) {
    case "week":
      return { from: shiftIsoDate(today, -6), to: today };
    case "month":
      return { from: shiftIsoDate(today, -29), to: today };
    case "quarter":
      // Thirteen whole weeks, the current one last.
      return { from: shiftIsoDate(weekStartOf(today, settings), -7 * 12), to: today };
    case "year":
      // Twelve months, the current one last.
      return { from: shiftMonths(monthStart(today), -11), to: today };
    case "custom": {
      const [from, to] =
        horizon.from <= horizon.to ? [horizon.from, horizon.to] : [horizon.to, horizon.from];
      const span = daysBetween({ from, to });
      return span > CUSTOM_MAX_DAYS
        ? { from: shiftIsoDate(to, -(CUSTOM_MAX_DAYS - 1)), to }
        : { from, to };
    }
  }
}

/** Days for a week or a month, weeks for a quarter, months for a year; a custom range by its length. */
export function bucketUnit(horizon: Horizon, range: DateRange): BucketUnit {
  if (horizon.kind === "week" || horizon.kind === "month") return "day";
  if (horizon.kind === "quarter") return "week";
  if (horizon.kind === "year") return "month";
  const days = daysBetween(range);
  if (days <= 62) return "day";
  if (days <= 366) return "week";
  return "month";
}

/** The first day of the bucket a day falls into. */
export function bucketKeyOf(day: IsoDate, unit: BucketUnit, settings: FormatSettings): IsoDate {
  if (unit === "day") return day;
  if (unit === "week") return weekStartOf(day, settings);
  return monthStart(day);
}

/** Every bucket of the range in order, keyed by its first day (the first may start before the range). */
export function bucketKeys(
  range: DateRange,
  unit: BucketUnit,
  settings: FormatSettings,
): IsoDate[] {
  const keys: IsoDate[] = [];
  let key = bucketKeyOf(range.from, unit, settings);
  while (key <= range.to) {
    keys.push(key);
    key =
      unit === "day"
        ? shiftIsoDate(key, 1)
        : unit === "week"
          ? shiftIsoDate(key, 7)
          : shiftMonths(key, 1);
  }
  return keys;
}

function inRange(day: IsoDate | null, range: DateRange): day is IsoDate {
  return day !== null && day >= range.from && day <= range.to;
}

function zonedDay(instant: string | null, settings: FormatSettings): IsoDate | null {
  return instant ? instantToZonedParts(new Date(instant), settings.timeZone).date : null;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type TaskBucket = { key: IsoDate; onTime: number; late: number; missed: number };

/** Done tasks by the day they were done, missed ones by the day they were due. */
export function bucketTasks(
  tasks: readonly WorkTask[],
  range: DateRange,
  unit: BucketUnit,
  now: Date,
  settings: FormatSettings,
): TaskBucket[] {
  const rows = new Map<IsoDate, TaskBucket>(
    bucketKeys(range, unit, settings).map((key) => [key, { key, onTime: 0, late: 0, missed: 0 }]),
  );
  for (const task of tasks) {
    const outcome = taskOutcome(task, now, settings);
    if (outcome === "open") continue;
    const day = outcomeDay(task, outcome, settings);
    if (!inRange(day, range)) continue;
    const row = rows.get(bucketKeyOf(day, unit, settings));
    if (row) row[outcome] += 1;
  }
  return [...rows.values()];
}

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

export type ChartDeal = {
  id: string;
  value: number | null;
  currency: string;
  kind: "open" | "won" | "lost";
  createdAt: string;
  wonAt: string | null;
  lostAt: string | null;
};

export type DealBucket = {
  key: IsoDate;
  won: number;
  lost: number;
  opened: number;
  /** Sum of the won deals in the display currency only; currencies are never added up. */
  wonValue: number;
};

export function bucketDeals(
  deals: readonly ChartDeal[],
  range: DateRange,
  unit: BucketUnit,
  settings: FormatSettings,
): { rows: DealBucket[]; otherCurrencyWon: number } {
  const rows = new Map<IsoDate, DealBucket>(
    bucketKeys(range, unit, settings).map((key) => [
      key,
      { key, won: 0, lost: 0, opened: 0, wonValue: 0 },
    ]),
  );
  const at = (day: IsoDate) => rows.get(bucketKeyOf(day, unit, settings));
  let otherCurrencyWon = 0;
  for (const deal of deals) {
    const created = zonedDay(deal.createdAt, settings);
    if (inRange(created, range)) {
      const row = at(created);
      if (row) row.opened += 1;
    }
    if (deal.kind === "won") {
      const won = zonedDay(deal.wonAt, settings);
      if (inRange(won, range)) {
        const row = at(won);
        if (row) {
          row.won += 1;
          if (deal.currency === settings.currency) row.wonValue += deal.value ?? 0;
          else if (deal.value) otherCurrencyWon += 1;
        }
      }
    }
    if (deal.kind === "lost") {
      const lost = zonedDay(deal.lostAt, settings);
      if (inRange(lost, range)) {
        const row = at(lost);
        if (row) row.lost += 1;
      }
    }
  }
  return { rows: [...rows.values()], otherCurrencyWon };
}

// ---------------------------------------------------------------------------
// The four numbers
// ---------------------------------------------------------------------------

export type DashboardStats = {
  openTasks: number;
  overdueTasks: number;
  openDeals: number;
  /** Deals won inside the horizon. */
  wonDeals: number;
};

export function dashboardStats(
  tasks: readonly WorkTask[],
  deals: readonly ChartDeal[],
  range: DateRange,
  now: Date,
  settings: FormatSettings,
): DashboardStats {
  let openTasks = 0;
  let overdueTasks = 0;
  for (const task of tasks) {
    const outcome = taskOutcome(task, now, settings);
    if (outcome === "open" || outcome === "missed") openTasks += 1;
    if (outcome === "missed") overdueTasks += 1;
  }
  return {
    openTasks,
    overdueTasks,
    openDeals: deals.filter((deal) => deal.kind === "open").length,
    wonDeals: deals.filter(
      (deal) => deal.kind === "won" && inRange(zonedDay(deal.wonAt, settings), range),
    ).length,
  };
}

/** The range ending today for a horizon, in the user's zone. */
export function currentRange(horizon: Horizon, now: Date, settings: FormatSettings): DateRange {
  return horizonRange(horizon, todayIsoDate(settings, now), settings);
}
