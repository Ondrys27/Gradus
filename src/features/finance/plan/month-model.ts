import type { IsoDate } from "@/lib/format";
import { actualValues, assignTransactions, type Assignment, type PlanTransaction } from "./assign";
import { pipelineSuggestions, type DealForPlan, type PipelineSuggestion } from "./carry-over";
import type { LoadedPlan } from "./load";
import {
  computeSheet,
  diffValues,
  isEmptyRow,
  kindsOf,
  OTHER_ROW,
  planValues,
  rowsOfKind,
  type PlanKind,
  type PlanRow,
  type PlanView,
  type RowValues,
  type Sheet,
} from "./sheet";
import { isWeekPast, monthWeeks, type PlanMonthKey, type PlanWeek } from "./weeks";

/**
 * Everything the Month table shows, computed from the stored plan, the
 * month's transactions and the open deals: what each cell displays in the
 * chosen view (plan, actual, difference), the small actual under a planned
 * number of a week that is over, the totals and the summary.
 */

export type ModelRow = PlanRow & {
  /** What the row's cells show in the chosen view. */
  shown: number[];
  /** The plan (blue, editable in the plan view). */
  plan: number[];
  /** The actuals, or null while they are not loaded. */
  actual: number[] | null;
  total: number;
  empty: boolean;
};

export type MonthModel = {
  month: PlanMonthKey;
  weeks: PlanWeek[];
  /** Weeks that are over (their Sunday is before today). */
  pastWeeks: number;
  currentWeek: number | null;
  rows: Record<PlanKind, ModelRow[]>;
  other: Record<PlanKind, ModelRow | null>;
  /** The sheet of the chosen view (difference: actual minus plan). */
  sheet: Sheet;
  /** The plan sheet and, once loaded, the actual one (for the summary and the small numbers). */
  planSheet: Sheet;
  actualSheet: Sheet | null;
  assignments: Assignment[];
  suggestions: PipelineSuggestion[];
  hiddenRows: number;
};

export function buildMonthModel(input: {
  monthKey: PlanMonthKey;
  plan: LoadedPlan;
  transactions: PlanTransaction[] | null;
  deals: DealForPlan[];
  view: PlanView;
  today: IsoDate;
  hideEmpty: boolean;
  categoryNames: Record<string, string[]>;
}): MonthModel {
  const { plan, view } = input;
  const weeks = monthWeeks(input.monthKey);
  const count = weeks.length;
  const record = plan.month;
  const currency = record?.currency ?? "CZK";
  const opening = record?.opening_capital ?? 0;
  const reserve = record?.reserve ?? null;
  const kinds = kindsOf(plan.rows);

  const planned = planValues(plan.rows, plan.cells, count);
  planned.set(OTHER_ROW.income, Array<number>(count).fill(0));
  planned.set(OTHER_ROW.expense, Array<number>(count).fill(0));
  const assignments = input.transactions
    ? assignTransactions({
        month: input.monthKey,
        currency,
        rows: plan.rows,
        transactions: input.transactions,
        categoryNames: input.categoryNames,
      })
    : [];
  const actual: RowValues | null = input.transactions ? actualValues(assignments, plan.rows, count) : null;

  const planSheet = computeSheet({ weeks: count, opening, kinds, values: planned, reserve });
  const actualSheet = actual ? computeSheet({ weeks: count, opening, kinds, values: actual, reserve }) : null;
  const shownValues: RowValues =
    view === "plan" || !actual ? planned : view === "actual" ? actual : diffValues(planned, actual, count);
  const sheet =
    view === "plan" || !actualSheet
      ? planSheet
      : view === "actual"
        ? actualSheet
        : computeSheet({ weeks: count, opening: 0, kinds, values: shownValues });

  const pastWeeks = weeks.filter((week) => isWeekPast(week, input.today)).length;
  const currentWeek = weeks.find((week) => week.start <= input.today && input.today <= week.end)?.week ?? null;

  let hiddenRows = 0;
  const model = (row: PlanRow): ModelRow => {
    const sources = actual ? [planned, actual] : [planned];
    return {
      ...row,
      shown: shownValues.get(row.id) ?? Array<number>(count).fill(0),
      plan: planned.get(row.id) ?? Array<number>(count).fill(0),
      actual: actual?.get(row.id) ?? null,
      total: sheet.rows.get(row.id)?.total ?? 0,
      empty: isEmptyRow(row.id, ...sources),
    };
  };
  const rows = {} as Record<PlanKind, ModelRow[]>;
  const other = {} as Record<PlanKind, ModelRow | null>;
  for (const kind of ["income", "expense"] as const) {
    const all = rowsOfKind(plan.rows, kind).map(model);
    const visible = input.hideEmpty ? all.filter((row) => !row.empty) : all;
    hiddenRows += all.length - visible.length;
    rows[kind] = visible;
    const otherRow = model({
      id: OTHER_ROW[kind],
      kind,
      label: "",
      position: Number.MAX_SAFE_INTEGER,
      source: "manual",
      source_id: null,
    });
    other[kind] = actual && !otherRow.empty ? otherRow : null;
  }

  return {
    month: input.monthKey,
    weeks,
    pastWeeks,
    currentWeek,
    rows,
    other,
    sheet,
    planSheet,
    actualSheet,
    assignments,
    suggestions: record
      ? pipelineSuggestions({ month: input.monthKey, currency, rows: plan.rows, deals: input.deals })
      : [],
    hiddenRows,
  };
}

/** The value a transaction gets for "Add transaction" from a cell: the week's day closest to today. */
export function dayForNewTransaction(week: PlanWeek, today: IsoDate): IsoDate {
  if (today < week.start) return week.start;
  if (today > week.end) return week.end;
  return today;
}
