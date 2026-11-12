import type { Db } from "@/lib/ops";
import type { Json } from "@/types/database";
import { ToolError } from "./types";

/**
 * Undo of Grady's changes. A tool notes every record it changed: what it
 * inserted, and for what it updated the fields' values before. Undo takes
 * back exactly that change: deletes what was inserted, writes the old values
 * back. When a record changed since in some other way (its updated_at, or
 * for a table without one the changed fields, is no longer what the change
 * left), Undo says so and changes nothing.
 *
 * Everything goes with the user's own client: an undo is a write like any
 * other (RLS, guards, read-only mode).
 */

/** Tables a tool may write, and whether the database keeps their updated_at. */
export const UNDO_TABLES = {
  milestones: true,
  tasks: true,
  notes: true,
  note_links: false,
  contacts: true,
  contact_activities: true,
  deals: true,
  deal_contacts: true,
  crm_tasks: true,
  calendar_events: true,
  transactions: true,
  recurring_payments: true,
  invoices: true,
  finance_plan_cells: true,
  worker_groups: true,
  worker_group_members: false,
  workers: true,
  user_settings: true,
  profiles: true,
  event_types: true,
} as const;
export type UndoTable = keyof typeof UNDO_TABLES;

export type Match = Record<string, string | number>;

export type UndoRecord = {
  table: UndoTable;
  /** The row: its id, or the columns of its key (finance_plan_cells: row_id + week). */
  match: Match;
  op: "insert" | "update";
  /** update: the changed fields as they were before. */
  before?: Record<string, Json>;
  /** update: the same fields as the change left them (compared where there is no updated_at). */
  after?: Record<string, Json>;
  /** updated_at as the change left it; null for a table without one. */
  stamp?: string | null;
};

/** The row as it is now: its updated_at and the fields Undo compares, or null when it is gone. */
export type CurrentRow = Record<string, Json> | null;

export type UndoStep =
  | { kind: "delete"; record: UndoRecord }
  | { kind: "restore"; record: UndoRecord; values: Record<string, Json> }
  /** Inserted and already gone (deleted with its parent, or by hand): nothing to do. */
  | { kind: "skip"; record: UndoRecord };

export type UndoPlan =
  { ok: true; steps: UndoStep[] } | { ok: false; reason: "changed" | "gone"; record: UndoRecord };

function same(a: Json | undefined, b: Json | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Whether the row is still as the change left it. */
function untouched(record: UndoRecord, row: Record<string, Json>): boolean {
  if (UNDO_TABLES[record.table] && record.stamp) {
    return same(row.updated_at, record.stamp) || sameInstant(row.updated_at, record.stamp);
  }
  for (const [field, value] of Object.entries(record.after ?? {})) {
    if (!same(row[field], value)) return false;
  }
  return true;
}

/** Postgres and JavaScript write the same instant differently (+00:00 / Z, precision). */
function sameInstant(a: Json | undefined, b: string): boolean {
  return typeof a === "string" && Date.parse(a) === Date.parse(b) && !Number.isNaN(Date.parse(b));
}

/**
 * What Undo does for the records of one action, newest first, or why it can
 * not: one record changed (or an updated one is gone) refuses the whole undo.
 */
export function planUndo(
  records: UndoRecord[],
  current: (record: UndoRecord) => CurrentRow,
): UndoPlan {
  const steps: UndoStep[] = [];
  for (const record of [...records].reverse()) {
    const row = current(record);
    if (record.op === "insert") {
      if (!row) {
        steps.push({ kind: "skip", record });
        continue;
      }
      if (!untouched(record, row)) return { ok: false, reason: "changed", record };
      steps.push({ kind: "delete", record });
    } else {
      if (!row) return { ok: false, reason: "gone", record };
      if (!untouched(record, row)) return { ok: false, reason: "changed", record };
      steps.push({ kind: "restore", record, values: record.before ?? {} });
    }
  }
  return { ok: true, steps };
}

function keyOf(record: Pick<UndoRecord, "table" | "match">): string {
  return `${record.table}:${JSON.stringify(Object.entries(record.match).sort())}`;
}

type DbError = { code?: string; message?: string } | null;
type Filter = PromiseLike<{ data: unknown; error: DbError }> & {
  eq(column: string, value: string | number): Filter;
  maybeSingle(): PromiseLike<{ data: unknown; error: DbError }>;
};
/** The few calls Undo makes, on any of its tables (the names are only known at run time). */
type LooseTable = {
  select(columns: string): Filter;
  update(values: Record<string, Json>): Filter;
  delete(): Filter;
};

function tableOf(db: Db, table: UndoTable): LooseTable {
  return db.from(table) as unknown as LooseTable;
}

function matching(query: Filter, match: Match): Filter {
  let next = query;
  for (const [column, value] of Object.entries(match)) next = next.eq(column, value);
  return next;
}

/** Columns read to check a record: updated_at, or the changed fields. */
function columnsOf(record: UndoRecord): string[] {
  const columns = new Set<string>(Object.keys(record.match));
  if (UNDO_TABLES[record.table]) columns.add("updated_at");
  for (const field of Object.keys(record.after ?? {})) columns.add(field);
  return [...columns];
}

/** One row of a table by its match, through RLS. */
export async function readRow(
  db: Db,
  table: UndoTable,
  match: Match,
  columns: string[],
): Promise<Record<string, Json> | null> {
  const { data, error } = await matching(
    tableOf(db, table).select(columns.join(", ")),
    match,
  ).maybeSingle();
  if (error) throw error;
  return (data as Record<string, Json> | null) ?? null;
}

/**
 * The fields of a row before an update, for its record. Throws notFound when
 * the user can not see the row (an id the model made up, or another space).
 */
export async function before(
  db: Db,
  table: UndoTable,
  match: Match,
  fields: string[],
): Promise<Record<string, Json>> {
  const row = await readRow(db, table, match, [...new Set([...Object.keys(match), ...fields])]);
  if (!row) throw new ToolError("notFound");
  const values: Record<string, Json> = {};
  for (const field of fields) values[field] = row[field] ?? null;
  return values;
}

/**
 * Notes how the change left each record (updated_at, or the changed
 * fields), right after the tool finished, so a later change is recognised.
 */
export async function stampRecords(db: Db, records: UndoRecord[]): Promise<UndoRecord[]> {
  const out: UndoRecord[] = [];
  for (const record of records) {
    // A tool that noted the state after the change itself (a custom undo) keeps it.
    if (record.after) {
      out.push(record);
      continue;
    }
    const fields = record.op === "update" ? Object.keys(record.before ?? {}) : [];
    const columns = [
      ...new Set([
        ...Object.keys(record.match),
        ...(UNDO_TABLES[record.table] ? ["updated_at"] : []),
        ...fields,
      ]),
    ];
    const row = await readRow(db, record.table, record.match, columns).catch(() => null);
    const after: Record<string, Json> = {};
    for (const field of fields) after[field] = row?.[field] ?? null;
    out.push({
      ...record,
      ...(fields.length ? { after } : {}),
      stamp: UNDO_TABLES[record.table] ? ((row?.updated_at as string | undefined) ?? null) : null,
    });
  }
  return out;
}

export type UndoResult = { ok: true } | { ok: false; reason: "changed" | "gone" | "failed" };

/** Takes back the change of one action: checks every record first, then undoes them newest first. */
export async function undoRecords(db: Db, records: UndoRecord[]): Promise<UndoResult> {
  const rows = new Map<string, CurrentRow>();
  for (const record of records) {
    rows.set(keyOf(record), await readRow(db, record.table, record.match, columnsOf(record)));
  }
  const plan = planUndo(records, (record) => rows.get(keyOf(record)) ?? null);
  if (!plan.ok) return { ok: false, reason: plan.reason };
  for (const step of plan.steps) {
    if (step.kind === "skip") continue;
    const table = tableOf(db, step.record.table);
    const query = step.kind === "delete" ? table.delete() : table.update(step.values);
    const { error } = await matching(query, step.record.match);
    if (error) {
      console.error("grady undo failed", step.record.table, error.code);
      return { ok: false, reason: "failed" };
    }
  }
  return { ok: true };
}
