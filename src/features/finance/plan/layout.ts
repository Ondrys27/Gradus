import { csvCell } from "@/features/account/data-export";
import { normalizeLabel } from "./assign";
import { parseAmountInput } from "./amount-input";
import { LABEL_MAX, PLAN_ROWS_MAX, uniqueLabel, type NewPlanRow } from "./carry-over";
import { rowsOfKind, type PlanKind, type PlanRow, type RowValues } from "./sheet";

/**
 * The month as a file, laid out like the table on screen (and like the
 * owner's sheet it replaces): weeks across, Opening capital, INCOME with its
 * rows and total, EXPENSES the same, CAPITAL with the week's balance and the
 * closing capital, the month summary to the right. The XLSX keeps formulas
 * for everything computed (blue numbers are typed in, black ones are
 * formulas); the CSV has the values. Importing reads the same layout back.
 */

export type GridStyle = "text" | "header" | "heading" | "input" | "computed" | "total" | "legend";
export type GridCell = { v: string | number | null; f?: string; style: GridStyle };
export type Grid = { cells: GridCell[][]; widths: number[]; decimals: boolean };

export type PlanLayoutTexts = {
  title: string;
  /** One per week, e.g. "Týden 1 (2. 11. – 8. 11.)". */
  weeks: string[];
  total: string;
  opening: string;
  income: string;
  incomeTotal: string;
  expense: string;
  expenseTotal: string;
  capital: string;
  balance: string;
  closing: string;
  summary: string;
  summaryOpening: string;
  summaryIncome: string;
  summaryExpense: string;
  summaryBalance: string;
  summaryClosing: string;
  summaryLowest: string;
  summaryLowestWeek: string;
  legend: string;
};

/** Spreadsheet column letters: 0 → A, 26 → AA. */
export function columnName(index: number): string {
  let name = "";
  let rest = index + 1;
  while (rest > 0) {
    const digit = (rest - 1) % 26;
    name = String.fromCharCode(65 + digit) + name;
    rest = Math.floor((rest - 1) / 26);
  }
  return name;
}

const ref = (column: number, row: number) => `${columnName(column)}${row + 1}`;
const round = (value: number) => Math.round(value * 100) / 100;
const sum = (values: number[]) => round(values.reduce((total, value) => total + value, 0));

export function planGrid(input: {
  texts: PlanLayoutTexts;
  rows: PlanRow[];
  values: RowValues;
  opening: number;
}): Grid {
  const { texts } = input;
  const weeks = texts.weeks.length;
  const totalColumn = weeks + 1;
  const lastWeek = columnName(weeks);
  const cells: GridCell[][] = [];
  const text = (v: string, style: GridStyle = "text"): GridCell => ({ v, style });
  const blank = (): GridCell[] => [];
  let decimals = Math.round(input.opening) !== input.opening;

  cells.push([text(texts.title, "header"), ...texts.weeks.map((week) => text(week, "header")), text(texts.total, "header")]);
  const openingRow = cells.length;
  cells.push([]); // filled once the closing row is known
  cells.push(blank());

  // Each block: heading, rows, total. Returns the row index of the total.
  const block = (kind: PlanKind, heading: string, totalLabel: string): { totalRow: number; values: number[] } => {
    cells.push([text(heading, "heading")]);
    const first = cells.length;
    const rows = rowsOfKind(input.rows, kind);
    const totals = Array<number>(weeks).fill(0);
    for (const row of rows) {
      const values = Array.from({ length: weeks }, (_, index) => input.values.get(row.id)?.[index] ?? 0);
      values.forEach((value, index) => {
        totals[index] = round(totals[index] + value);
        if (Math.round(value) !== value) decimals = true;
      });
      const at = cells.length;
      cells.push([
        text(row.label),
        ...values.map((value): GridCell => ({ v: value === 0 ? null : value, style: "input" })),
        { v: sum(values), f: `SUM(B${at + 1}:${lastWeek}${at + 1})`, style: "computed" },
      ]);
    }
    const last = cells.length - 1;
    const totalRow = cells.length;
    cells.push([
      text(totalLabel, "total"),
      ...Array.from({ length: weeks + 1 }, (_, index): GridCell => {
        const column = columnName(index + 1);
        const value = index < weeks ? totals[index] : sum(totals);
        return rows.length
          ? { v: value, f: `SUM(${column}${first + 1}:${column}${last + 1})`, style: "total" }
          : { v: 0, style: "total" };
      }),
    ]);
    cells.push(blank());
    return { totalRow, values: totals };
  };

  const income = block("income", texts.income, texts.incomeTotal);
  const expense = block("expense", texts.expense, texts.expenseTotal);

  cells.push([text(texts.capital, "heading")]);
  const balanceRow = cells.length;
  const balances = income.values.map((value, index) => round(value - expense.values[index]));
  cells.push([
    text(texts.balance, "total"),
    ...Array.from({ length: weeks + 1 }, (_, index): GridCell => {
      const column = columnName(index + 1);
      return {
        v: index < weeks ? balances[index] : sum(balances),
        f: `${column}${income.totalRow + 1}-${column}${expense.totalRow + 1}`,
        style: "total",
      };
    }),
  ]);
  const closingRow = cells.length;
  const openings: number[] = [];
  const closings: number[] = [];
  let running = input.opening;
  for (const value of balances) {
    openings.push(running);
    running = round(running + value);
    closings.push(running);
  }
  cells.push([
    text(texts.closing, "total"),
    ...closings.map((value, index): GridCell => ({
      v: value,
      f: `${ref(index + 1, openingRow)}+${ref(index + 1, balanceRow)}`,
      style: "total",
    })),
    { v: closings[weeks - 1] ?? input.opening, f: ref(weeks, closingRow), style: "total" },
  ]);
  cells[openingRow] = [
    text(texts.opening, "total"),
    { v: input.opening, style: "input" },
    ...openings.slice(1).map((value, index): GridCell => ({
      v: value,
      f: ref(index + 1, closingRow),
      style: "computed",
    })),
    { v: input.opening, f: ref(1, openingRow), style: "computed" },
  ];
  cells.push(blank());
  cells.push([text(texts.legend, "legend")]);

  // The summary, two columns to the right of the total.
  const labelColumn = totalColumn + 2;
  const closingRange = `${ref(1, closingRow)}:${ref(weeks, closingRow)}`;
  let lowest = { value: closings[0] ?? input.opening, week: 1 };
  closings.forEach((value, index) => {
    if (value < lowest.value) lowest = { value, week: index + 1 };
  });
  const summary: [string, GridCell][] = [
    [texts.summaryOpening, { v: input.opening, f: ref(1, openingRow), style: "computed" }],
    [texts.summaryIncome, { v: sum(income.values), f: ref(totalColumn, income.totalRow), style: "computed" }],
    [texts.summaryExpense, { v: sum(expense.values), f: ref(totalColumn, expense.totalRow), style: "computed" }],
    [texts.summaryBalance, { v: sum(balances), f: ref(totalColumn, balanceRow), style: "computed" }],
    [texts.summaryClosing, { v: closings[weeks - 1] ?? input.opening, f: ref(totalColumn, closingRow), style: "total" }],
    [texts.summaryLowest, { v: lowest.value, f: `MIN(${closingRange})`, style: "computed" }],
    [
      texts.summaryLowestWeek,
      {
        v: texts.weeks[lowest.week - 1] ?? "",
        f: `INDEX(${ref(1, 0)}:${ref(weeks, 0)},MATCH(MIN(${closingRange}),${closingRange},0))`,
        style: "computed",
      },
    ],
  ];
  const put = (row: number, column: number, cell: GridCell) => {
    while (cells.length <= row) cells.push([]);
    const line = cells[row];
    while (line.length < column) line.push({ v: null, style: "text" });
    line[column] = cell;
  };
  put(0, labelColumn, text(texts.summary, "header"));
  summary.forEach(([label, cell], index) => {
    put(index + 1, labelColumn, text(label));
    put(index + 1, labelColumn + 1, cell);
  });

  const widths = Array.from({ length: labelColumn + 2 }, (_, index) =>
    index === 0 ? 30 : index === labelColumn ? 24 : index === totalColumn + 1 ? 3 : 16,
  );
  return { cells, widths, decimals };
}

/** The values of the grid as CSV: UTF-8 with a byte order mark, comma separated, CRLF. */
export function gridToCsv(grid: Grid): string {
  const width = Math.max(...grid.cells.map((line) => line.length));
  const lines = grid.cells.map((line) =>
    Array.from({ length: width }, (_, index) => csvCell(line[index]?.v ?? null)).join(","),
  );
  return `﻿${lines.join("\r\n")}\r\n`;
}

// -----------------------------------------------------------------------------
// Import
// -----------------------------------------------------------------------------

export const IMPORT_MAX_BYTES = 512 * 1024;
const IMPORT_MAX_LINES = 2_000;

/** RFC 4180 with the delimiter guessed from the first lines (comma, semicolon or tab). */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const sample = source.split(/\r?\n/).slice(0, 10).join("\n");
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const char of sample) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char in counts) counts[char as keyof typeof counts] += 1;
  }
  const delimiter = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ",") as string;
  const result: string[][] = [];
  let line: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else inQuotes = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field === "") inQuotes = true;
    else if (char === delimiter) {
      line.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      line.push(field);
      result.push(line);
      line = [];
      field = "";
      if (result.length > IMPORT_MAX_LINES) break;
    } else field += char;
  }
  if (field !== "" || line.length) {
    line.push(field);
    result.push(line);
  }
  return result;
}

const NAMES = {
  opening: ["pocatecni kapital", "vstupni kapital", "opening capital", "starting capital"],
  income: ["prijmy", "income", "incomes"],
  incomeTotal: ["prijmy celkem", "total income", "income total", "celkem prijmy"],
  expense: ["vydaje", "expenses", "expense", "costs"],
  expenseTotal: ["vydaje celkem", "total expenses", "expenses total", "celkem vydaje"],
  capital: [
    "kapital",
    "capital",
    "bilance tydne",
    "bilance",
    "weekly balance",
    "balance",
    "konecny kapital",
    "closing capital",
    "ending capital",
  ],
};
const WEEK_HEADER = /^(tyden|week|wk|t)\.?\s*([1-5])\b/;

export type ImportedPlan = { opening: number | null; rows: NewPlanRow[]; weeksInFile: number };
export type ImportProblem = "tooLarge" | "notPlanLayout" | "tooManyRows";

/** An amount cell of a sheet: "8 500 Kč", "Kč 8,500.00", "(2 000)", "–" (empty). */
function readAmount(raw: string, decimal: "," | "."): number | null {
  let text = raw.trim();
  if (!text || /^[-–—]$/.test(text)) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text
    .replace(/(kč|czk|eur|usd|gbp|pln|chf|[€$£])/gi, "")
    .replace(/[^\d.,\-−–+*/()\s  '’kKmM]/g, "");
  const parsed = parseAmountInput(text, decimal);
  if (!parsed.ok || parsed.value === null) return null;
  return negative ? -parsed.value : parsed.value;
}

/**
 * Reads a CSV in the layout of the export (or of the owner's sheet): the
 * header row has the week columns ("Týden 1", "Week 1"…), everything else
 * (Total, the summary) is left out; rows between INCOME and its total are
 * income, between EXPENSES and its total expenses, Opening capital gives the
 * opening; the computed rows are not read. Weeks the month does not have go
 * into its last week, so nothing goes missing. Never trusts the file: limits
 * on size and rows, names cut to 120 characters and made unique.
 */
export function importPlanCsv(
  text: string,
  options: { weeks: number; decimal: "," | "." },
): { ok: true; plan: ImportedPlan } | { ok: false; problem: ImportProblem } {
  if (text.length > IMPORT_MAX_BYTES) return { ok: false, problem: "tooLarge" };
  const lines = parseCsv(text);
  let header = -1;
  const weekColumns = new Map<number, number>();
  for (let index = 0; index < Math.min(lines.length, 30) && header < 0; index += 1) {
    lines[index].forEach((cell, column) => {
      const match = WEEK_HEADER.exec(normalizeLabel(cell));
      if (match) weekColumns.set(column, Number(match[2]));
    });
    if (weekColumns.size >= 2) header = index;
    else weekColumns.clear();
  }
  if (header < 0) return { ok: false, problem: "notPlanLayout" };
  const labelColumn = Math.max(0, Math.min(...weekColumns.keys()) - 1);
  const weeksInFile = Math.max(...weekColumns.values());

  let section: PlanKind | null = null;
  let opening: number | null = null;
  const drafts = new Map<string, { kind: PlanKind; label: string; values: number[] }>();
  const order: string[] = [];
  let found = false;
  for (const line of lines.slice(header + 1)) {
    const label = (line[labelColumn] ?? "").replace(/^'/, "").trim();
    const name = normalizeLabel(label);
    if (!name) continue;
    if (NAMES.opening.includes(name)) {
      const first = [...weekColumns.entries()].sort((a, b) => a[1] - b[1])[0];
      opening = first ? readAmount(line[first[0]] ?? "", options.decimal) : null;
      found = true;
      continue;
    }
    if (NAMES.incomeTotal.includes(name) || NAMES.expenseTotal.includes(name) || NAMES.capital.includes(name)) {
      section = null;
      continue;
    }
    if (NAMES.income.includes(name)) {
      section = "income";
      found = true;
      continue;
    }
    if (NAMES.expense.includes(name)) {
      section = "expense";
      found = true;
      continue;
    }
    if (!section) continue;
    const values = Array<number>(options.weeks).fill(0);
    for (const [column, week] of weekColumns) {
      const value = readAmount(line[column] ?? "", options.decimal);
      if (value === null) continue;
      const target = Math.min(week, options.weeks) - 1;
      values[target] = round(values[target] + value);
    }
    const key = `${section}:${name}`;
    const existing = drafts.get(key);
    if (existing) {
      values.forEach((value, index) => {
        existing.values[index] = round(existing.values[index] + value);
      });
    } else {
      if (drafts.size >= PLAN_ROWS_MAX) return { ok: false, problem: "tooManyRows" };
      drafts.set(key, { kind: section, label: label.slice(0, LABEL_MAX), values });
      order.push(key);
    }
  }
  if (!found) return { ok: false, problem: "notPlanLayout" };

  const rows: NewPlanRow[] = [];
  for (const kind of ["income", "expense"] as const) {
    const taken: string[] = [];
    let position = 0;
    for (const key of order) {
      const draft = drafts.get(key);
      if (!draft || draft.kind !== kind) continue;
      const label = uniqueLabel(draft.label, taken);
      taken.push(label);
      rows.push({
        kind,
        label,
        position: position++,
        source: "manual",
        source_id: null,
        cells: draft.values
          .map((planned, index) => ({ week: index + 1, planned }))
          .filter((cell) => cell.planned !== 0),
      });
    }
  }
  return { ok: true, plan: { opening, rows, weeksInFile } };
}
