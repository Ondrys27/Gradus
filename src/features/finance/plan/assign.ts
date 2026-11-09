import type { IsoDate } from "@/lib/format";
import { OTHER_ROW, rowsOfKind, type PlanKind, type PlanRow, type RowValues } from "./sheet";
import { weekInMonth, type PlanMonthKey } from "./weeks";

/** A transaction as the plan reads it; `contact_id` is the contact of its invoice or deal. */
export type PlanTransaction = {
  id: string;
  type: PlanKind;
  amount: number;
  currency: string;
  category: string | null;
  description: string | null;
  occurred_on: IsoDate;
  recurring_payment_id: string | null;
  invoice_id: string | null;
  deal_id: string | null;
  contact_id: string | null;
};

export type Assignment = { transaction: PlanTransaction; rowId: string; week: number };

/** Lower case, no diacritics, single spaces: "Nájem " and "najem" are one name. */
export function normalizeLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Which row a transaction of the month belongs to, always the same answer for
 * the same data. In this order, among the rows of its block (income or
 * expense), the first by position:
 *   1. its source: the recurring payment, the invoice, the deal, then the
 *      contact of the invoice or deal, matched to a row made from that source;
 *   2. its category: the category key or its name (in any language) equals
 *      the row's name;
 *   3. its description equals the row's name;
 *   4. otherwise "Other" of the block.
 * Transactions in another currency than the month's, or outside its weeks,
 * are left out (amounts are never converted).
 */
export function assignTransactions(input: {
  month: PlanMonthKey;
  currency: string;
  rows: PlanRow[];
  transactions: PlanTransaction[];
  /** Category key → its names in the languages of the app. */
  categoryNames: Record<string, string[]>;
}): Assignment[] {
  const { month, currency, rows } = input;
  const ordered = { income: rowsOfKind(rows, "income"), expense: rowsOfKind(rows, "expense") };
  const bySource = new Map<string, string>();
  const byName = { income: new Map<string, string>(), expense: new Map<string, string>() };
  for (const kind of ["income", "expense"] as const) {
    for (const row of ordered[kind]) {
      if (row.source !== "manual" && row.source_id) {
        const key = `${kind}:${row.source}:${row.source_id}`;
        if (!bySource.has(key)) bySource.set(key, row.id);
      }
      const name = normalizeLabel(row.label);
      if (!byName[kind].has(name)) byName[kind].set(name, row.id);
    }
  }
  const categoryLabels = new Map<string, string[]>();
  for (const [key, names] of Object.entries(input.categoryNames)) {
    categoryLabels.set(key, [key, ...names].map(normalizeLabel));
  }

  const result: Assignment[] = [];
  for (const transaction of input.transactions) {
    if (transaction.currency !== currency) continue;
    const week = weekInMonth(month, transaction.occurred_on);
    if (week === null) continue;
    const kind = transaction.type;
    const source = (name: string, id: string | null) =>
      id ? bySource.get(`${kind}:${name}:${id}`) : undefined;
    let rowId =
      source("recurring", transaction.recurring_payment_id) ??
      source("invoice", transaction.invoice_id) ??
      source("deal", transaction.deal_id) ??
      source("contact", transaction.contact_id);
    if (!rowId && transaction.category) {
      for (const name of categoryLabels.get(transaction.category) ?? [normalizeLabel(transaction.category)]) {
        rowId = byName[kind].get(name);
        if (rowId) break;
      }
    }
    if (!rowId && transaction.description) {
      rowId = byName[kind].get(normalizeLabel(transaction.description));
    }
    result.push({ transaction, rowId: rowId ?? OTHER_ROW[kind], week });
  }
  return result;
}

/** The actual values per row and week (the two "other" rows included). */
export function actualValues(assignments: Assignment[], rows: PlanRow[], weeks: number): RowValues {
  const values: RowValues = new Map(
    [...rows.map((row) => row.id), OTHER_ROW.income, OTHER_ROW.expense].map((id) => [
      id,
      Array<number>(weeks).fill(0),
    ]),
  );
  for (const { transaction, rowId, week } of assignments) {
    const line = values.get(rowId);
    if (!line || week > weeks) continue;
    line[week - 1] = Math.round(line[week - 1] * 100 + transaction.amount * 100) / 100;
  }
  return values;
}

/** The transactions behind one cell of the actuals, newest first. */
export function transactionsOfCell(assignments: Assignment[], rowId: string, week: number): PlanTransaction[] {
  return assignments
    .filter((item) => item.rowId === rowId && item.week === week)
    .map((item) => item.transaction)
    .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || a.id.localeCompare(b.id));
}
