import { addMonths, endOfMonth, startOfMonth, startOfYear } from "date-fns";
import { isoDateToLocal, localToIsoDate, type IsoDate } from "@/lib/format";
import type { InvoiceDisplayStatus, Invoice, PeriodKind } from "./types";

export type DateRange = { from: IsoDate; to: IsoDate };

/** Both ends included, as calendar days in the user's zone (`today` comes from there). */
export function periodRange(kind: PeriodKind, today: IsoDate): DateRange {
  const now = isoDateToLocal(today);
  switch (kind) {
    case "thisMonth":
      return { from: localToIsoDate(startOfMonth(now)), to: localToIsoDate(endOfMonth(now)) };
    case "lastMonth": {
      const last = addMonths(now, -1);
      return { from: localToIsoDate(startOfMonth(last)), to: localToIsoDate(endOfMonth(last)) };
    }
    case "last3Months":
      return {
        from: localToIsoDate(startOfMonth(addMonths(now, -2))),
        to: localToIsoDate(endOfMonth(now)),
      };
    case "thisYear":
      return { from: localToIsoDate(startOfYear(now)), to: localToIsoDate(endOfMonth(now)) };
    case "last12Months":
      return chartRange(today);
  }
}

/** The twelve months ending with the current one. */
export function chartRange(today: IsoDate): DateRange {
  const now = isoDateToLocal(today);
  return {
    from: localToIsoDate(startOfMonth(addMonths(now, -11))),
    to: localToIsoDate(endOfMonth(now)),
  };
}

/** The plain number put back into an amount field when editing. */
export function amountToInput(amount: number): string {
  return String(amount);
}

export function displayInvoiceStatus(
  invoice: Pick<Invoice, "status" | "due_on">,
  today: IsoDate,
): InvoiceDisplayStatus {
  switch (invoice.status) {
    case "paid":
      return "paid";
    case "cancelled":
    case "uncollectible":
      return "closed";
    case "draft":
      return "draft";
    default:
      return invoice.due_on && invoice.due_on < today ? "overdue" : "pending";
  }
}

export type MonthlyRow = { month: string; income: number; expense: number };

export function balanceOf(totals: { income: number; expense: number }): number {
  return Math.round((totals.income - totals.expense) * 100) / 100;
}

export const PAGE_SIZE = 20;

export function pageCount(total: number, pageSize = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Whole amounts show without cents, everything else with two. */
export function decimalsFor(amount: number): 0 | 2 {
  return Number.isInteger(amount) ? 0 : 2;
}

// -----------------------------------------------------------------------------
// The zoomable income chart (dashboard tile detail and the Finance page)
// -----------------------------------------------------------------------------

export type ChartKind = "month" | "year";
export type DailyRow = { day: IsoDate; income: number; expense: number };
/** One bar: `key` is the day (month view) or the first of the month (year view). */
export type ChartRow = { key: IsoDate; income: number; expense: number; cumulativeIncome: number };

function addCumulativeIncome(
  rows: { key: IsoDate; income: number; expense: number }[],
): ChartRow[] {
  let running = 0;
  return rows.map((row) => {
    running = Math.round((running + row.income) * 100) / 100;
    return { ...row, cumulativeIncome: running };
  });
}

/** Rows for the Month view: one bar per day of the current month. */
export function dailyChartRows(rows: DailyRow[]): ChartRow[] {
  return addCumulativeIncome(
    rows.map((row) => ({ key: row.day, income: row.income, expense: row.expense })),
  );
}

/** Rows for the Year view: one bar per month, the same twelve months as `chartRange`. */
export function monthlyChartRows(rows: MonthlyRow[]): ChartRow[] {
  return addCumulativeIncome(
    rows.map((row) => ({ key: row.month, income: row.income, expense: row.expense })),
  );
}

/** The zoom window is a pair of indices into the chart's row array, both included. */
export type ZoomWindow = { start: number; end: number };
const MIN_WINDOW_SIZE = 2;

export function fullWindow(length: number): ZoomWindow {
  return { start: 0, end: Math.max(0, length - 1) };
}

function clampFraction(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Keeps the window's size and start inside `[0, length)`, never smaller than two bars. */
export function clampWindow(length: number, window: ZoomWindow): ZoomWindow {
  if (length <= 1) return { start: 0, end: 0 };
  const maxIndex = length - 1;
  const size = Math.min(maxIndex + 1, Math.max(MIN_WINDOW_SIZE, window.end - window.start + 1));
  const start = Math.max(0, Math.min(Math.round(window.start), maxIndex - size + 1));
  return { start, end: start + size - 1 };
}

/**
 * Zooms by `factor` (< 1 in, > 1 out) around `fraction` (0 to 1), the cursor's
 * position inside the current window — used for the wheel, the +/- buttons
 * (fraction 0.5) and pinch.
 */
export function zoomWindow(
  length: number,
  window: ZoomWindow,
  factor: number,
  fraction: number,
): ZoomWindow {
  const size = window.end - window.start + 1;
  const at = clampFraction(fraction);
  const cursor = window.start + at * size;
  const nextSize = Math.min(length, Math.max(MIN_WINDOW_SIZE, size * factor));
  const start = cursor - at * nextSize;
  return clampWindow(length, { start, end: start + nextSize - 1 });
}

/** Shifts the window by `deltaIndex` bars, keeping its size — dragging and one-finger pan. */
export function panWindow(length: number, window: ZoomWindow, deltaIndex: number): ZoomWindow {
  return clampWindow(length, { start: window.start + deltaIndex, end: window.end + deltaIndex });
}

/** The calendar range the zoomed-in bars cover, for the totals and the transaction list. */
export function zoomedRange(kind: ChartKind, rows: ChartRow[], window: ZoomWindow): DateRange {
  const last = rows.length - 1;
  const startRow = rows[Math.max(0, Math.min(window.start, last))];
  const endRow = rows[Math.max(0, Math.min(window.end, last))];
  const to = kind === "year" ? localToIsoDate(endOfMonth(isoDateToLocal(endRow.key))) : endRow.key;
  return { from: startRow.key, to };
}
