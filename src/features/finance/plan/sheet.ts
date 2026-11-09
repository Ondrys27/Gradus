/**
 * The month plan as a spreadsheet: rows of income and expenses by week, the
 * opening capital carried from week to week, the balance and the closing
 * capital, and the month summary with the lowest point. Pure functions, all
 * sums in whole cents so 0.1 + 0.2 never shows up as 0.30000000000000004.
 * Nothing here is stored: the database keeps the entered numbers only.
 */

export type PlanKind = "income" | "expense";
export const PLAN_KINDS: readonly PlanKind[] = ["income", "expense"];
export type PlanSource = "manual" | "contact" | "deal" | "recurring" | "invoice";
export const PLAN_SOURCES: readonly PlanSource[] = ["manual", "contact", "deal", "recurring", "invoice"];

export type PlanRow = {
  id: string;
  kind: PlanKind;
  label: string;
  position: number;
  source: PlanSource;
  source_id: string | null;
};
export type PlanCell = { row_id: string; week: number; planned: number; note: string | null };
export type PlanMonthRecord = {
  id: string;
  month: string;
  opening_capital: number;
  reserve: number | null;
  currency: string;
  closed: boolean;
};

/** The pseudo rows for transactions no row claims, one per block. */
export const OTHER_ROW: Record<PlanKind, string> = { income: "other:income", expense: "other:expense" };
export function isOtherRow(id: string): boolean {
  return id === OTHER_ROW.income || id === OTHER_ROW.expense;
}

export const PLAN_VIEWS = ["plan", "actual", "diff"] as const;
export type PlanView = (typeof PLAN_VIEWS)[number];

/** Values of one row, index 0 = week 1. */
export type RowValues = Map<string, number[]>;

export type Line = { weeks: number[]; total: number };
export type LowestPoint = { value: number; week: number };
export type SheetWarning = "negative" | "reserve" | null;
export type SheetSummary = {
  opening: number;
  income: number;
  expense: number;
  balance: number;
  closing: number;
  lowest: LowestPoint;
  warning: SheetWarning;
};
export type Sheet = {
  weeks: number;
  rows: Map<string, Line>;
  income: Line;
  expense: Line;
  balance: Line;
  /** Week 1 = the entered opening capital, then the previous week's closing; total = week 1. */
  opening: Line;
  /** Opening + balance of the week; total = the last week's. */
  closing: Line;
  summary: SheetSummary;
};

const cents = (value: number) => Math.round(value * 100);
const money = (value: number) => {
  const result = value / 100;
  return result === 0 ? 0 : result;
};

/** A row's values from the entered cells, zero where nothing is entered. */
export function planValues(rows: PlanRow[], cells: PlanCell[], weeks: number): RowValues {
  const values: RowValues = new Map(rows.map((row) => [row.id, Array<number>(weeks).fill(0)]));
  for (const cell of cells) {
    const line = values.get(cell.row_id);
    if (!line || cell.week < 1 || cell.week > weeks) continue;
    line[cell.week - 1] = money(cents(line[cell.week - 1]) + cents(cell.planned));
  }
  return values;
}

/** Actual minus plan, per row and week (rows only in one of them count as zero in the other). */
export function diffValues(plan: RowValues, actual: RowValues, weeks: number): RowValues {
  const ids = new Set([...plan.keys(), ...actual.keys()]);
  const result: RowValues = new Map();
  for (const id of ids) {
    const p = plan.get(id) ?? Array<number>(weeks).fill(0);
    const a = actual.get(id) ?? Array<number>(weeks).fill(0);
    result.set(
      id,
      Array.from({ length: weeks }, (_, index) => money(cents(a[index] ?? 0) - cents(p[index] ?? 0))),
    );
  }
  return result;
}

/**
 * The best guess for the month: what really happened in the weeks that are
 * over, the plan for this week and the ones to come.
 */
export function projectedValues(
  plan: RowValues,
  actual: RowValues,
  weeks: number,
  pastWeeks: number,
): RowValues {
  const ids = new Set([...plan.keys(), ...actual.keys()]);
  const result: RowValues = new Map();
  for (const id of ids) {
    const p = plan.get(id) ?? Array<number>(weeks).fill(0);
    const a = actual.get(id) ?? Array<number>(weeks).fill(0);
    result.set(
      id,
      Array.from({ length: weeks }, (_, index) => (index < pastWeeks ? (a[index] ?? 0) : (p[index] ?? 0))),
    );
  }
  return result;
}

function line(weeks: number[]): Line {
  return { weeks, total: money(weeks.reduce((sum, value) => sum + cents(value), 0)) };
}

/**
 * Below zero is always a warning; below the reserve (when one is set) too.
 * The lowest point is the lowest closing capital of a week, the earliest
 * week on a tie.
 */
export function computeSheet(input: {
  weeks: number;
  opening: number;
  kinds: Map<string, PlanKind>;
  values: RowValues;
  reserve?: number | null;
}): Sheet {
  const { weeks, kinds, values } = input;
  const rows = new Map<string, Line>();
  const income = Array<number>(weeks).fill(0);
  const expense = Array<number>(weeks).fill(0);
  for (const [id, weekValues] of values) {
    const kind = kinds.get(id);
    if (!kind) continue;
    const normalized = Array.from({ length: weeks }, (_, index) => weekValues[index] ?? 0);
    rows.set(id, line(normalized));
    const target = kind === "income" ? income : expense;
    normalized.forEach((value, index) => {
      target[index] = money(cents(target[index]) + cents(value));
    });
  }
  const balance = income.map((value, index) => money(cents(value) - cents(expense[index])));
  const opening: number[] = [];
  const closing: number[] = [];
  let running = cents(input.opening);
  for (let index = 0; index < weeks; index += 1) {
    opening.push(money(running));
    running += cents(balance[index]);
    closing.push(money(running));
  }
  const incomeLine = line(income);
  const expenseLine = line(expense);
  const balanceLine = line(balance);
  let lowest: LowestPoint = { value: closing[0] ?? input.opening, week: 1 };
  closing.forEach((value, index) => {
    if (value < lowest.value) lowest = { value, week: index + 1 };
  });
  const reserve = input.reserve ?? null;
  const warning: SheetWarning =
    lowest.value < 0 ? "negative" : reserve !== null && lowest.value < reserve ? "reserve" : null;
  const closingValue = closing[weeks - 1] ?? input.opening;
  return {
    weeks,
    rows,
    income: incomeLine,
    expense: expenseLine,
    balance: balanceLine,
    opening: { weeks: opening, total: opening[0] ?? input.opening },
    closing: { weeks: closing, total: closingValue },
    summary: {
      opening: input.opening,
      income: incomeLine.total,
      expense: expenseLine.total,
      balance: balanceLine.total,
      closing: closingValue,
      lowest,
      warning,
    },
  };
}

/** Kinds of the rows and of the two "other" pseudo rows. */
export function kindsOf(rows: PlanRow[]): Map<string, PlanKind> {
  const kinds = new Map<string, PlanKind>(rows.map((row) => [row.id, row.kind]));
  kinds.set(OTHER_ROW.income, "income");
  kinds.set(OTHER_ROW.expense, "expense");
  return kinds;
}

/** Rows of a block in the order the user arranged them. */
export function rowsOfKind(rows: PlanRow[], kind: PlanKind): PlanRow[] {
  return rows
    .filter((row) => row.kind === kind)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

/** A row without a single number in the plan (and no actuals): what "hide empty" hides. */
export function isEmptyRow(id: string, ...sources: RowValues[]): boolean {
  return sources.every((values) => (values.get(id) ?? []).every((value) => value === 0));
}

export type CashLowFinding = {
  week: number;
  /** The capital expected at the end of that week (actuals so far, the plan from now on). */
  closing: number;
  /** 0, or the reserve when it is set. */
  threshold: number;
  /** The largest expense planned in that week, the usual reason. */
  cause: { label: string; amount: number } | null;
  /** Income rows planned in weeks already over that have not (fully) come in. */
  missingIncomes: number;
};

/**
 * When the capital is going to drop below zero or below the reserve in this
 * week or a later one of the month. Only from the numbers: nothing is said
 * about a week that is over, and nothing when the month is fine.
 */
export function cashLowFinding(input: {
  rows: PlanRow[];
  plan: RowValues;
  actual: RowValues;
  weeks: number;
  /** Weeks of the month that are over (0 = the month has not started, weeks = it is over). */
  pastWeeks: number;
  opening: number;
  reserve: number | null;
}): CashLowFinding | null {
  const { rows, plan, actual, weeks, pastWeeks } = input;
  if (pastWeeks >= weeks) return null;
  const projected = projectedValues(plan, actual, weeks, pastWeeks);
  const sheet = computeSheet({ weeks, opening: input.opening, kinds: kindsOf(rows), values: projected });
  const threshold = Math.max(0, input.reserve ?? 0);
  let week = -1;
  for (let index = pastWeeks; index < weeks; index += 1) {
    const value = sheet.closing.weeks[index];
    if (value < 0 || (input.reserve !== null && value < threshold)) {
      week = index;
      break;
    }
  }
  if (week < 0) return null;
  let cause: CashLowFinding["cause"] = null;
  for (const row of rowsOfKind(rows, "expense")) {
    const amount = plan.get(row.id)?.[week] ?? 0;
    if (amount > 0 && (!cause || amount > cause.amount)) cause = { label: row.label, amount };
  }
  let missingIncomes = 0;
  for (const row of rowsOfKind(rows, "income")) {
    const planned = plan.get(row.id) ?? [];
    const got = actual.get(row.id) ?? [];
    let missing = false;
    for (let index = 0; index < pastWeeks; index += 1) {
      if ((planned[index] ?? 0) > 0 && (got[index] ?? 0) < (planned[index] ?? 0)) missing = true;
    }
    if (missing) missingIncomes += 1;
  }
  return { week: week + 1, closing: sheet.closing.weeks[week], threshold, cause, missingIncomes };
}
