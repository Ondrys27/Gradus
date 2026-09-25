import { addMonths, endOfMonth, startOfMonth, startOfYear } from "date-fns";
import {
  isoDateToLocal,
  localToIsoDate,
  type IsoDate,
} from "@/lib/format";
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
