import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  endOfYear,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "date-fns";
import { isoDateToLocal, localToIsoDate, type IsoDate, type WeekStart } from "@/lib/format";

export type PeriodKind = "week" | "month" | "year";
export type Period = {
  kind: PeriodKind;
  /** 0 = the current one, -1 = the one before, … */ offset: number;
};
export type Range = { from: IsoDate; to: IsoDate };

/** Calendar range of a period around `today` (the user's date), weeks starting as they set. */
export function periodRange(period: Period, today: IsoDate, weekStartsOn: WeekStart): Range {
  const base = isoDateToLocal(today);
  if (period.kind === "week") {
    const day = addWeeks(base, period.offset);
    return {
      from: localToIsoDate(startOfWeek(day, { weekStartsOn })),
      to: localToIsoDate(endOfWeek(day, { weekStartsOn })),
    };
  }
  if (period.kind === "month") {
    const day = addMonths(base, period.offset);
    return { from: localToIsoDate(startOfMonth(day)), to: localToIsoDate(endOfMonth(day)) };
  }
  const day = addYears(base, period.offset);
  return { from: localToIsoDate(startOfYear(day)), to: localToIsoDate(endOfYear(day)) };
}

export function daysOf(range: Range): IsoDate[] {
  const from = isoDateToLocal(range.from);
  const count = differenceInCalendarDays(isoDateToLocal(range.to), from) + 1;
  return Array.from({ length: count }, (_, index) => localToIsoDate(addDays(from, index)));
}

export type Bar = {
  /** First day of the bar: the day itself, or the month in the year view. */
  key: IsoDate;
  value: number;
  /** Today, or this month in the year view. */
  current: boolean;
  future: boolean;
};

/** One bar a day; the year view adds days up by month. */
export function toBars(
  kind: PeriodKind,
  range: Range,
  byDay: Map<IsoDate, number>,
  today: IsoDate,
): Bar[] {
  const days = daysOf(range);
  if (kind !== "year") {
    return days.map((day) => ({
      key: day,
      value: byDay.get(day) ?? 0,
      current: day === today,
      future: day > today,
    }));
  }
  const months = new Map<string, Bar>();
  for (const day of days) {
    const month = `${day.slice(0, 7)}-01`;
    const bar = months.get(month) ?? {
      key: month,
      value: 0,
      current: month === `${today.slice(0, 7)}-01`,
      future: month > today,
    };
    bar.value += byDay.get(day) ?? 0;
    months.set(month, bar);
  }
  return [...months.values()];
}

export type Summary = {
  total: number;
  average: number;
  best: { day: IsoDate; value: number } | null;
};

/**
 * Total, average per day and the best day, over the days of the range that have
 * begun (future days would pull the average down).
 */
export function summarize(range: Range, byDay: Map<IsoDate, number>, today: IsoDate): Summary {
  const days = daysOf(range).filter((day) => day <= today);
  let total = 0;
  let best: Summary["best"] = null;
  for (const day of days) {
    const value = byDay.get(day) ?? 0;
    total += value;
    if (value > 0 && (!best || value > best.value)) best = { day, value };
  }
  return { total, average: days.length ? total / days.length : 0, best };
}
