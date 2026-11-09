import type { IsoDate } from "@/lib/format";
import { normalizeLabel } from "./assign";
import { rowsOfKind, type PlanCell, type PlanKind, type PlanRow, type PlanSource } from "./sheet";
import { addDays, monthSpan, weekCount, weekInMonth, type PlanMonthKey } from "./weeks";

/** A row the new month starts with, written in one call with its cells. */
export type NewPlanRow = {
  kind: PlanKind;
  label: string;
  position: number;
  source: PlanSource;
  source_id: string | null;
  cells: { week: number; planned: number }[];
};

export const LABEL_MAX = 120;
export const PLAN_ROWS_MAX = 300;

/** What "Create December from November" copies. */
export const CARRY_MODES = ["labels", "numbers", "recurring"] as const;
export type CarryMode = (typeof CARRY_MODES)[number];

export type RecurringForPlan = {
  id: string;
  type: PlanKind;
  amount: number;
  currency: string;
  description: string;
  frequency: "weekly" | "monthly" | "quarterly" | "yearly";
  next_due_on: IsoDate;
  due_day: number | null;
  ends_on: IsoDate | null;
  is_active: boolean;
};

export type InvoiceForPlan = {
  id: string;
  contact_id: string | null;
  customer_name: string | null;
  due_on: IsoDate | null;
  total: number;
  currency: string;
};

export type DealForPlan = {
  id: string;
  title: string;
  value: number | null;
  currency: string;
  expected_close_date: IsoDate | null;
  open: boolean;
};

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The due day after `from`, as the database's recurring_next_due() counts it. */
export function nextDue(from: IsoDate, frequency: RecurringForPlan["frequency"], dueDay: number | null): IsoDate {
  if (frequency === "weekly") return addDays(from, 7);
  const months = frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12;
  const [y, m, d] = from.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const day = Math.min(dueDay ?? d, daysInMonth(year, month));
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Every due day of a recurring payment between `from` and `to`, both included. */
export function recurringDueDates(payment: RecurringForPlan, from: IsoDate, to: IsoDate): IsoDate[] {
  if (!payment.is_active) return [];
  const dates: IsoDate[] = [];
  let due = payment.next_due_on;
  for (let guard = 0; guard < 800 && due <= to; guard += 1) {
    if (payment.ends_on && due > payment.ends_on) break;
    if (due >= from) dates.push(due);
    due = nextDue(due, payment.frequency, payment.due_day);
  }
  return dates;
}

/** "Rent", "Rent 2", "Rent 3": a name no row of the block has yet. */
export function uniqueLabel(label: string, taken: Iterable<string>): string {
  const names = new Set([...taken].map(normalizeLabel));
  const base = label.trim().slice(0, LABEL_MAX) || "—";
  if (!names.has(normalizeLabel(base))) return base;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = ` ${n}`;
    const candidate = base.slice(0, LABEL_MAX - suffix.length) + suffix;
    if (!names.has(normalizeLabel(candidate))) return candidate;
  }
  return base;
}

type Draft = NewPlanRow & { values: number[]; fedBy: Set<"recurring" | "invoice"> };

/**
 * The rows of a new month. From the previous month by `mode`: names only,
 * names with the numbers (week by week; a fifth week going into a 4-week
 * month is added to week 4 so the month's total stays), or only the rows of
 * recurring payments. Then, always, the recurring payments planned into the
 * week they fall due (a row fed by a payment takes its numbers from the
 * payment, never twice), and the unpaid invoices due in the month added to
 * the client's row. Only amounts in the month's currency; nothing converts.
 */
export function buildNewMonth(input: {
  month: PlanMonthKey;
  currency: string;
  previous?: { rows: PlanRow[]; cells: PlanCell[]; weeks: number } | null;
  mode: CarryMode;
  recurring: RecurringForPlan[];
  invoices: InvoiceForPlan[];
}): NewPlanRow[] {
  const weeks = weekCount(input.month);
  const span = monthSpan(input.month);
  const drafts: Draft[] = [];
  const blank = () => Array<number>(weeks).fill(0);
  const add = (values: number[], week: number, amount: number) => {
    values[week - 1] = Math.round(values[week - 1] * 100 + amount * 100) / 100;
  };

  if (input.previous) {
    for (const kind of ["income", "expense"] as const) {
      for (const row of rowsOfKind(input.previous.rows, kind)) {
        if (input.mode === "recurring" && row.source !== "recurring") continue;
        const values = blank();
        if (input.mode === "numbers") {
          for (const cell of input.previous.cells) {
            if (cell.row_id !== row.id || !cell.planned) continue;
            add(values, Math.min(cell.week, weeks), cell.planned);
          }
        }
        drafts.push({
          kind,
          label: row.label,
          position: 0,
          source: row.source,
          source_id: row.source_id,
          cells: [],
          values,
          fedBy: new Set(),
        });
      }
    }
  }

  const find = (kind: PlanKind, source: PlanSource, sourceId: string | null, label: string) =>
    drafts.find((draft) => draft.kind === kind && sourceId && draft.source === source && draft.source_id === sourceId) ??
    drafts.find((draft) => draft.kind === kind && normalizeLabel(draft.label) === normalizeLabel(label));

  const recurring = [...input.recurring].sort((a, b) => a.id.localeCompare(b.id));
  for (const payment of recurring) {
    if (payment.currency !== input.currency) continue;
    const dates = recurringDueDates(payment, span.from, span.to);
    if (!dates.length) continue;
    const label = payment.description.trim().slice(0, LABEL_MAX);
    let draft = find(payment.type, "recurring", payment.id, label);
    if (!draft) {
      draft = {
        kind: payment.type,
        label,
        position: 0,
        source: "recurring",
        source_id: payment.id,
        cells: [],
        values: blank(),
        fedBy: new Set(),
      };
      drafts.push(draft);
    }
    if (!draft.fedBy.has("recurring")) {
      // The payment decides this row's numbers; what was copied would count it twice.
      draft.values = blank();
      draft.fedBy.add("recurring");
    }
    for (const date of dates) {
      const week = weekInMonth(input.month, date);
      if (week !== null) add(draft.values, week, payment.amount);
    }
  }

  const invoices = [...input.invoices].sort((a, b) => a.id.localeCompare(b.id));
  for (const invoice of invoices) {
    if (invoice.currency !== input.currency || !invoice.due_on || invoice.total <= 0) continue;
    const week = weekInMonth(input.month, invoice.due_on);
    if (week === null) continue;
    const label = (invoice.customer_name ?? "").trim().slice(0, LABEL_MAX);
    const source: PlanSource = invoice.contact_id ? "contact" : "invoice";
    const sourceId = invoice.contact_id ?? invoice.id;
    let draft = find("income", source, sourceId, label || "\u0000");
    if (!draft) {
      draft = {
        kind: "income",
        label: label || "—",
        position: 0,
        source,
        source_id: sourceId,
        cells: [],
        values: blank(),
        fedBy: new Set(),
      };
      drafts.push(draft);
    }
    draft.fedBy.add("invoice");
    add(draft.values, week, invoice.total);
  }

  // Names unique per block, positions in order, cells only where there is a number.
  const result: NewPlanRow[] = [];
  for (const kind of ["income", "expense"] as const) {
    const taken: string[] = [];
    let position = 0;
    for (const draft of drafts.filter((item) => item.kind === kind)) {
      if (result.length >= PLAN_ROWS_MAX) break;
      const label = uniqueLabel(draft.label, taken);
      taken.push(label);
      result.push({
        kind,
        label,
        position: position++,
        source: draft.source,
        source_id: draft.source === "manual" ? null : draft.source_id,
        cells: draft.values
          .map((planned, index) => ({ week: index + 1, planned }))
          .filter((cell) => cell.planned !== 0),
      });
    }
  }
  return result;
}

/** An open deal expected to close in the month: a suggested income, one click from the plan. */
export type PipelineSuggestion = { dealId: string; label: string; week: number; amount: number };

export function pipelineSuggestions(input: {
  month: PlanMonthKey;
  currency: string;
  rows: PlanRow[];
  deals: DealForPlan[];
}): PipelineSuggestion[] {
  const accepted = new Set(
    input.rows.filter((row) => row.source === "deal" && row.source_id).map((row) => row.source_id),
  );
  return input.deals
    .filter(
      (deal) =>
        deal.open &&
        deal.currency === input.currency &&
        (deal.value ?? 0) > 0 &&
        deal.expected_close_date &&
        !accepted.has(deal.id),
    )
    .flatMap((deal) => {
      const week = weekInMonth(input.month, deal.expected_close_date as IsoDate);
      return week === null
        ? []
        : [{ dealId: deal.id, label: deal.title.trim().slice(0, LABEL_MAX), week, amount: deal.value as number }];
    })
    .sort((a, b) => a.week - b.week || a.label.localeCompare(b.label) || a.dealId.localeCompare(b.dealId));
}
