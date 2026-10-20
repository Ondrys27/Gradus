import { formatCalendarDate, type FormatSettings, type IsoDate } from "@/lib/format";
import { daysBetween, shiftDay } from "@/lib/analytics/metrics";
import { budgetStatus, type BudgetStatus } from "@/features/jarvis/budget";
import { MAX_RANGE_DAYS, type AdminView, type DateRange } from "./view-state";

/**
 * Jarvis's budget for the period chosen in the administration's top bar.
 * The caps stay monthly in the database and the check before a model call
 * (jarvis/server/budget.ts) keeps counting the calendar month; only what the
 * AI page shows is scaled to the period:
 *
 *   - 30 days: the calendar month as the check counts it, the monthly cap;
 *   - 7 days: monthly × 7 / days of the current month;
 *   - today: monthly / days of the current month;
 *   - 90 days, 12 months, a custom range: every day adds monthly / days of
 *     its own month, so a range over several months sums their daily caps
 *     (a whole calendar month gives exactly the monthly cap).
 *
 * The same factor scales the per-user cap and the warning threshold. Pure.
 */

export type BudgetPeriodKind = "month" | "today" | "7d" | "90d" | "12m" | "custom";
/** How the card names the scaled cap: "the weekly limit", "the limit for the period"… */
export type PeriodCapKind = "monthly" | "weekly" | "daily" | "period";

export type BudgetPeriod =
  | { kind: "month"; capKind: "monthly"; factor: 1 }
  | {
      kind: Exclude<BudgetPeriodKind, "month">;
      /** The days whose spend is summed, in the metrics time zone; ends today at the latest. */
      spend: DateRange;
      /** The days the cap is for: the custom range as asked, future days included. */
      capRange: DateRange;
      capKind: PeriodCapKind;
      /** Monthly caps × factor = the caps for the period. */
      factor: number;
    };

/** Days of the calendar month a day belongs to (28–31). */
export function daysInMonth(day: IsoDate): number {
  const [year, month] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Month-equivalents of a range: each day counts 1 / the days of its own month. */
export function monthShare(range: DateRange): number {
  return daysBetween(range.from, range.to).reduce((sum, day) => sum + 1 / daysInMonth(day), 0);
}

/** Whether a range is exactly one calendar month, first to last day. */
export function isWholeMonth(range: DateRange): boolean {
  return (
    range.from.endsWith("-01") &&
    range.from.slice(0, 7) === range.to.slice(0, 7) &&
    Number(range.to.slice(8, 10)) === daysInMonth(range.to)
  );
}

export function budgetPeriod(view: AdminView, range: DateRange, today: IsoDate): BudgetPeriod {
  switch (view.period) {
    case "30d":
      return { kind: "month", capKind: "monthly", factor: 1 };
    case "today":
      return { kind: "today", spend: range, capRange: range, capKind: "daily", factor: 1 / daysInMonth(today) };
    case "7d":
      return { kind: "7d", spend: range, capRange: range, capKind: "weekly", factor: 7 / daysInMonth(today) };
    case "90d":
    case "12m":
      return { kind: view.period, spend: range, capRange: range, capKind: "period", factor: monthShare(range) };
    case "custom": {
      // The spend stops today; the cap covers the range as asked (a whole month = the monthly cap).
      const last = shiftDay(range.from, MAX_RANGE_DAYS - 1);
      const asked = view.to && view.to > range.to ? view.to : range.to;
      const capRange = { from: range.from, to: asked > last ? last : asked };
      const length = daysBetween(capRange.from, capRange.to).length;
      const capKind: PeriodCapKind = isWholeMonth(capRange)
        ? "monthly"
        : length === 1
          ? "daily"
          : length === 7
            ? "weekly"
            : "period";
      return { kind: "custom", spend: range, capRange, capKind, factor: monthShare(capRange) };
    }
  }
}

/** A monthly cap scaled to the period. */
export function scaleCap(monthlyUsd: number, period: Pick<BudgetPeriod, "factor">): number {
  return monthlyUsd * period.factor;
}

export type PeriodFigures = {
  spentUsd: number;
  calls: number;
  /** The application-wide cap for the period. */
  capUsd: number;
  /** Spent / cap, 0–∞; 1 when the cap is 0. */
  share: number;
  /** Against the scaled cap and threshold; colours the meter only. */
  status: BudgetStatus;
};

/**
 * What the budget card shows: the calendar month as the check counts it, or
 * the period's spend against the scaled cap.
 */
export function periodFigures(
  period: BudgetPeriod,
  month: { spentUsd: number; calls: number; budgetUsd: number; warnShare: number },
  spend: { spentUsd: number; calls: number } | null,
): PeriodFigures {
  const usage = period.kind === "month" || !spend ? month : spend;
  const capUsd = period.kind === "month" ? month.budgetUsd : scaleCap(month.budgetUsd, period);
  return {
    spentUsd: usage.spentUsd,
    calls: usage.calls,
    capUsd,
    share: capUsd > 0 ? usage.spentUsd / capUsd : 1,
    status: budgetStatus(usage.spentUsd, capUsd, month.warnShare),
  };
}

/** A translator of the `admin.ai.period` namespace. */
type PeriodTranslate = (key: string, values?: Record<string, string>) => string;

/** The period in words for "Spend {period}": "this month", "over 7 days", "1. 9. 2026 – 30. 11. 2026". */
export function describePeriod(
  period: BudgetPeriod,
  t: PeriodTranslate,
  settings: FormatSettings,
): string {
  if (period.kind !== "custom") return t(period.kind);
  return t("custom", {
    from: formatCalendarDate(period.capRange.from, settings),
    to: formatCalendarDate(period.capRange.to, settings),
  });
}
