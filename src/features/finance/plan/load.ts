import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { PlanTransaction } from "./assign";
import type { DealForPlan, InvoiceForPlan, RecurringForPlan } from "./carry-over";
import type { PlanCell, PlanMonthRecord, PlanRow, PlanSource } from "./sheet";
import { monthSpan, type PlanMonthKey } from "./weeks";

/**
 * Reading the plan with the caller's own client (browser or server): row
 * level security decides what they see, every query is limited to the space
 * and the month. Shared by the Month view and Grady.
 */

type Client = SupabaseClient<Database>;

export const PLAN_MONTH_COLUMNS = "id, month, opening_capital, reserve, currency, closed";
const ROW_COLUMNS = "id, kind, label, position, source, source_id, finance_plan_cells(week, planned, note)";
const ROWS_LIMIT = 400;

export type LoadedPlan = { month: PlanMonthRecord | null; rows: PlanRow[]; cells: PlanCell[] };

export async function loadPlanMonth(client: Client, space: string, month: PlanMonthKey): Promise<LoadedPlan> {
  const [monthResult, rowsResult] = await Promise.all([
    client
      .from("finance_plan_months")
      .select(PLAN_MONTH_COLUMNS)
      .eq("user_id", space)
      .eq("month", month)
      .maybeSingle(),
    client
      .from("finance_plan_rows")
      .select(ROW_COLUMNS)
      .eq("user_id", space)
      .eq("month", month)
      .order("position")
      .limit(ROWS_LIMIT),
  ]);
  if (monthResult.error) throw monthResult.error;
  if (rowsResult.error) throw rowsResult.error;
  const record = monthResult.data;
  const rows: PlanRow[] = [];
  const cells: PlanCell[] = [];
  for (const row of rowsResult.data ?? []) {
    rows.push({
      id: row.id,
      kind: row.kind,
      label: row.label,
      position: row.position,
      source: row.source as PlanSource,
      source_id: row.source_id,
    });
    for (const cell of row.finance_plan_cells ?? []) {
      cells.push({ row_id: row.id, week: cell.week, planned: Number(cell.planned), note: cell.note });
    }
  }
  return {
    month: record
      ? {
          id: record.id,
          month: record.month,
          opening_capital: Number(record.opening_capital),
          reserve: record.reserve === null ? null : Number(record.reserve),
          currency: record.currency,
          closed: record.closed,
        }
      : null,
    rows,
    cells,
  };
}

/** The months of the space that exist among `months` (for the overview and the carry-over). */
export async function loadPlanMonths(client: Client, space: string, months: PlanMonthKey[]) {
  const { data, error } = await client
    .from("finance_plan_months")
    .select(PLAN_MONTH_COLUMNS)
    .eq("user_id", space)
    .in("month", months)
    .limit(24);
  if (error) throw error;
  return (data ?? []).map(
    (record): PlanMonthRecord => ({
      id: record.id,
      month: record.month,
      opening_capital: Number(record.opening_capital),
      reserve: record.reserve === null ? null : Number(record.reserve),
      currency: record.currency,
      closed: record.closed,
    }),
  );
}

/** The transactions of the month's weeks (from its first Monday to its last Sunday). */
export async function loadPlanTransactions(
  client: Client,
  space: string,
  month: PlanMonthKey,
): Promise<PlanTransaction[]> {
  const span = monthSpan(month);
  const { data, error } = await client.rpc("finance_plan_transactions", {
    _space: space,
    _from: span.from,
    _to: span.to,
  });
  if (error) throw error;
  return (data ?? []).map((row) => ({ ...row, amount: Number(row.amount) }));
}

/** What a new month is planned from: active recurring payments, unpaid invoices due in it. */
export async function loadCarrySources(
  client: Client,
  space: string,
  month: PlanMonthKey,
): Promise<{ recurring: RecurringForPlan[]; invoices: InvoiceForPlan[] }> {
  const span = monthSpan(month);
  const [recurring, invoices] = await Promise.all([
    client
      .from("recurring_payments")
      .select("id, type, amount, currency, description, frequency, next_due_on, due_day, ends_on, is_active")
      .eq("user_id", space)
      .eq("is_active", true)
      .lte("next_due_on", span.to)
      .limit(200),
    client
      .from("invoices")
      .select("id, contact_id, customer_name, customer, due_on, total, currency")
      .eq("user_id", space)
      .eq("kind", "invoice")
      .in("status", ["open", "sent", "overdue"])
      .gte("due_on", span.from)
      .lte("due_on", span.to)
      .limit(200),
  ]);
  if (recurring.error) throw recurring.error;
  // A worker without the invoices right simply gets none.
  const invoiceRows = invoices.error ? [] : (invoices.data ?? []);
  return {
    recurring: (recurring.data ?? []).map((payment) => ({ ...payment, amount: Number(payment.amount) })),
    invoices: invoiceRows.map((invoice) => {
      const customer = (invoice.customer ?? {}) as { name?: unknown };
      return {
        id: invoice.id,
        contact_id: invoice.contact_id,
        customer_name: invoice.customer_name ?? (typeof customer.name === "string" ? customer.name : null),
        due_on: invoice.due_on,
        total: Number(invoice.total),
        currency: invoice.currency,
      };
    }),
  };
}

/** Open deals of the space whose Close Date falls in the month's weeks. */
export async function loadPlanDeals(client: Client, space: string, month: PlanMonthKey): Promise<DealForPlan[]> {
  const span = monthSpan(month);
  const { data, error } = await client
    .from("deals")
    .select("id, title, value, currency, expected_close_date, pipeline_stages(is_won, is_lost)")
    .eq("user_id", space)
    .gte("expected_close_date", span.from)
    .lte("expected_close_date", span.to)
    .limit(100);
  // Without the pipeline right there is nothing to suggest.
  if (error) return [];
  return (data ?? []).map((deal) => {
    const stage = deal.pipeline_stages as { is_won: boolean; is_lost: boolean } | null;
    return {
      id: deal.id,
      title: deal.title,
      value: deal.value === null ? null : Number(deal.value),
      currency: deal.currency,
      expected_close_date: deal.expected_close_date,
      open: Boolean(stage) && !stage?.is_won && !stage?.is_lost,
    };
  });
}
