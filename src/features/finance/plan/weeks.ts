import type { IsoDate } from "@/lib/format";

/**
 * Weeks of the plan month. A plan month is "YYYY-MM"; its weeks are the ISO
 * weeks (Monday to Sunday) whose Monday falls in that month, so a month has 4
 * or 5 of them. A week reaching into the next month belongs to the month of
 * its Monday: 30 November – 6 December 2026 is week 5 of November, and the
 * first days of a month before its first Monday belong to the previous month
 * (1 November 2026, a Sunday, is in week 4 of October). Pure calendar dates,
 * computed in UTC only to stay clear of daylight saving; the dates themselves
 * are the user's days.
 */

export type PlanMonthKey = string;
export type PlanWeek = { week: number; start: IsoDate; end: IsoDate };

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY_MS = 86_400_000;

export function isPlanMonth(value: unknown): value is PlanMonthKey {
  return typeof value === "string" && MONTH_PATTERN.test(value);
}

function parts(month: PlanMonthKey): { year: number; month: number } {
  const match = MONTH_PATTERN.exec(month);
  if (!match) throw new Error(`invalid plan month: ${month}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

function toIso(time: number): IsoDate {
  return new Date(time).toISOString().slice(0, 10);
}

function fromIso(date: IsoDate): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return toIso(fromIso(date) + days * DAY_MS);
}

/** 1 = Monday … 7 = Sunday. */
function isoWeekday(time: number): number {
  const day = new Date(time).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The Monday of the ISO week containing `date`. */
export function mondayOf(date: IsoDate): IsoDate {
  const time = fromIso(date);
  return toIso(time - (isoWeekday(time) - 1) * DAY_MS);
}

export function monthKey(year: number, month: number): PlanMonthKey {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

export function shiftMonth(month: PlanMonthKey, delta: number): PlanMonthKey {
  const { year, month: m } = parts(month);
  const index = year * 12 + (m - 1) + delta;
  return monthKey(Math.floor(index / 12), (index % 12) + 1);
}

/** The month number 1–12, for the month names in the translations. */
export function monthNumber(month: PlanMonthKey): number {
  return parts(month).month;
}

export function monthYear(month: PlanMonthKey): number {
  return parts(month).year;
}

/** The weeks of a plan month, 4 or 5. */
export function monthWeeks(month: PlanMonthKey): PlanWeek[] {
  const { year, month: m } = parts(month);
  const first = Date.UTC(year, m - 1, 1);
  const firstMonday = first + ((8 - isoWeekday(first)) % 7) * DAY_MS;
  const weeks: PlanWeek[] = [];
  for (let monday = firstMonday; new Date(monday).getUTCMonth() === m - 1; monday += 7 * DAY_MS) {
    weeks.push({ week: weeks.length + 1, start: toIso(monday), end: toIso(monday + 6 * DAY_MS) });
  }
  return weeks;
}

export function weekCount(month: PlanMonthKey): number {
  return monthWeeks(month).length;
}

/** From the first Monday to the last Sunday: the days whose money the month counts. */
export function monthSpan(month: PlanMonthKey): { from: IsoDate; to: IsoDate } {
  const weeks = monthWeeks(month);
  return { from: weeks[0].start, to: weeks[weeks.length - 1].end };
}

/** The plan month and week a day belongs to (by the Monday of its ISO week). */
export function planWeekOf(date: IsoDate): { month: PlanMonthKey; week: number } {
  const monday = mondayOf(date);
  const month = monday.slice(0, 7);
  return { month, week: Math.floor((Number(monday.slice(8, 10)) - 1) / 7) + 1 };
}

/** The week of `month` a day falls in, or null when the day belongs to another month. */
export function weekInMonth(month: PlanMonthKey, date: IsoDate): number | null {
  const found = planWeekOf(date);
  return found.month === month ? found.week : null;
}

/** Whether the week is over on `today` (its Sunday is before today). */
export function isWeekPast(week: PlanWeek, today: IsoDate): boolean {
  return week.end < today;
}

/** The week of `month` that contains today, or null. */
export function currentWeek(month: PlanMonthKey, today: IsoDate): number | null {
  return weekInMonth(month, today);
}
