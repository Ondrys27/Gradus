import { toCsv } from "@/features/account/data-export";
import { dayStart } from "@/features/crm-tasks/logic";
import {
  formatCsvDecimal,
  formatDate,
  todayIsoDate,
  type FormatSettings,
  type IsoDate,
} from "@/lib/format";
import { currencyDigits } from "@/lib/currency";
import type { EntryStatus, RewardEntry, RewardPayout, RewardTotals, SourceKind } from "./types";

/**
 * Sums and lists of rewards for the screens: the tiles, what waits to be
 * paid, the work table and the payouts file. Amounts of different currencies
 * are never added up; every sum is per currency.
 */

type TotalsRow = {
  worker_id: string;
  currency: string;
  earned: number | string;
  pending: number | string;
  pending_count: number;
  approved: number | string;
  approved_count: number;
  planned: number | string;
  planned_count: number;
  paid: number | string;
};

export function totalsFromRows(rows: readonly TotalsRow[]): RewardTotals[] {
  return rows.map((row) => ({
    workerId: row.worker_id,
    currency: row.currency,
    earned: Number(row.earned),
    pending: Number(row.pending),
    pendingCount: row.pending_count,
    approved: Number(row.approved),
    approvedCount: row.approved_count,
    planned: Number(row.planned),
    plannedCount: row.planned_count,
    paid: Number(row.paid),
  }));
}

/** The totals of several people added up per currency (the company's row of tiles). */
export function totalsByCurrency(totals: readonly RewardTotals[]): RewardTotals[] {
  const map = new Map<string, RewardTotals>();
  for (const item of totals) {
    const sum = map.get(item.currency);
    if (!sum) {
      map.set(item.currency, { ...item, workerId: "" });
      continue;
    }
    sum.earned += item.earned;
    sum.pending += item.pending;
    sum.pendingCount += item.pendingCount;
    sum.approved += item.approved;
    sum.approvedCount += item.approvedCount;
    sum.planned += item.planned;
    sum.plannedCount += item.plannedCount;
    sum.paid += item.paid;
  }
  return [...map.values()].map(roundTotals).sort(byMain);
}

function roundTotals(item: RewardTotals): RewardTotals {
  const r = (value: number) => Math.round(value * 100) / 100;
  return {
    ...item,
    earned: r(item.earned),
    pending: r(item.pending),
    approved: r(item.approved),
    planned: r(item.planned),
    paid: r(item.paid),
  };
}

/** The currency with most going on first, then by code. */
function byMain(a: RewardTotals, b: RewardTotals): number {
  const weight = (item: RewardTotals) =>
    item.pendingCount + item.approvedCount + item.plannedCount + (item.earned !== 0 ? 1 : 0);
  return weight(b) - weight(a) || a.currency.localeCompare(b.currency);
}

/** This month in the user's zone, as instants for the database. */
export function monthBounds(settings: FormatSettings, now: Date = new Date()): { from: string; until: string } {
  const today = todayIsoDate(settings, now);
  const first = `${today.slice(0, 7)}-01` as IsoDate;
  const [year, month] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return {
    from: dayStart(first, settings.timeZone).toISOString(),
    until: dayStart(next, settings.timeZone).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// What a worker has coming
// ---------------------------------------------------------------------------

const TASK_SOURCES: readonly SourceKind[] = ["crm_task", "worker_task", "task"];

/** "12 000 Kč for 3 tasks waits for you": the planned rewards per currency, tasks counted apart. */
export function plannedSummary(
  entries: readonly Pick<RewardEntry, "status" | "amount" | "currency" | "source_kind">[],
): Array<{ currency: string; amount: number; tasks: number; other: number }> {
  const map = new Map<string, { currency: string; amount: number; tasks: number; other: number }>();
  for (const entry of entries) {
    if (entry.status !== "planned") continue;
    const item = map.get(entry.currency) ?? { currency: entry.currency, amount: 0, tasks: 0, other: 0 };
    item.amount = Math.round((item.amount + entry.amount) * 100) / 100;
    if (TASK_SOURCES.includes(entry.source_kind)) item.tasks += 1;
    else item.other += 1;
    map.set(entry.currency, item);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

// ---------------------------------------------------------------------------
// Paying out
// ---------------------------------------------------------------------------

/** Approved entries ready to pay, per currency, with what a payout of them would total. */
export function payoutGroups(
  entries: readonly Pick<RewardEntry, "id" | "status" | "amount" | "currency">[],
): Array<{ currency: string; ids: string[]; total: number }> {
  const map = new Map<string, { currency: string; ids: string[]; total: number }>();
  for (const entry of entries) {
    if (entry.status !== "approved") continue;
    const group = map.get(entry.currency) ?? { currency: entry.currency, ids: [], total: 0 };
    group.ids.push(entry.id);
    group.total = Math.round((group.total + entry.amount) * 100) / 100;
    map.set(entry.currency, group);
  }
  return [...map.values()];
}

/**
 * What a chosen set pays: one currency and a positive total, or why not
 * (a deduction larger than the rewards, two currencies, nothing chosen).
 */
export function payoutCheck(
  entries: readonly Pick<RewardEntry, "status" | "amount" | "currency">[],
): { ok: true; currency: string; total: number } | { ok: false; reason: "empty" | "mixed" | "notPositive" | "notApproved" } {
  if (entries.length === 0) return { ok: false, reason: "empty" };
  if (entries.some((entry) => entry.status !== "approved")) return { ok: false, reason: "notApproved" };
  const currencies = new Set(entries.map((entry) => entry.currency));
  if (currencies.size > 1) return { ok: false, reason: "mixed" };
  const total = Math.round(entries.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100;
  if (total <= 0) return { ok: false, reason: "notPositive" };
  return { ok: true, currency: entries[0]!.currency, total };
}

export type PayoutCsvLabels = {
  paidOn: string;
  worker: string;
  from: string;
  to: string;
  entries: string;
  amount: string;
  currency: string;
  note: string;
};

/** The payouts as a CSV file: one row each, the date in the user's format, amounts with a dot. */
export function payoutsCsv(
  payouts: readonly RewardPayout[],
  nameOf: (workerId: string) => string,
  settings: FormatSettings,
  labels: PayoutCsvLabels,
): string {
  const columns = [
    labels.paidOn,
    labels.worker,
    labels.from,
    labels.to,
    labels.entries,
    labels.amount,
    labels.currency,
    labels.note,
  ];
  const day = (value: string | null) =>
    value ? formatDate(new Date(`${value}T12:00:00Z`), { ...settings, timeZone: "UTC" }) : "";
  const rows = payouts.map((payout) => ({
    [labels.paidOn]: formatDate(new Date(payout.paid_at), settings),
    [labels.worker]: nameOf(payout.worker_id),
    [labels.from]: day(payout.period_from),
    [labels.to]: day(payout.period_to),
    [labels.entries]: String(payout.entries),
    [labels.amount]: formatCsvDecimal(payout.total, currencyDigits(payout.currency)),
    [labels.currency]: payout.currency,
    [labels.note]: payout.note ?? "",
  }));
  return toCsv(columns, rows);
}

// ---------------------------------------------------------------------------
// The work table: what a source earned
// ---------------------------------------------------------------------------

/** The entries of each source, by its id (corrections and planned ones included). */
export function entriesBySource(
  entries: readonly RewardEntry[],
): Map<string, RewardEntry[]> {
  const map = new Map<string, RewardEntry[]>();
  for (const entry of entries) {
    if (!entry.source_id) continue;
    const list = map.get(entry.source_id) ?? [];
    list.push(entry);
    map.set(entry.source_id, list);
  }
  return map;
}

/** One status for a row of several entries: the one that needs the owner most. */
const STATUS_ORDER: readonly EntryStatus[] = ["pending", "approved", "planned", "paid", "rejected"];

export function rowStatus(entries: readonly Pick<RewardEntry, "status">[]): EntryStatus | null {
  for (const status of STATUS_ORDER) {
    if (entries.some((entry) => entry.status === status)) return status;
  }
  return null;
}

/** The sum of a row's entries per currency, rejected ones left out. */
export function rowAmounts(
  entries: readonly Pick<RewardEntry, "status" | "amount" | "currency">[],
): Array<{ currency: string; amount: number }> {
  const map = new Map<string, number>();
  for (const entry of entries) {
    if (entry.status === "rejected") continue;
    map.set(entry.currency, Math.round(((map.get(entry.currency) ?? 0) + entry.amount) * 100) / 100);
  }
  return [...map.entries()].map(([currency, amount]) => ({ currency, amount }));
}
