import type { UndoRecord, UndoTable } from "@/features/grady/tools/records";
import type { Json } from "@/types/database";

/**
 * The trash for what Grady and connected apps (MCP) delete (28.8). Deals and
 * contacts wait in their tables with deleted_at (trash_record() in the
 * database hides them and what hangs only on them); the other rows a tool
 * deletes are kept here as their Undo records and come back through the
 * person's own client. Everything is restorable for the retention set in
 * the administration (TRASH_RETENTION_DEFAULT days), then purge_trash()
 * removes it for good. Notes keep their own trash (30 days).
 */

export const TRASH_KINDS = [
  "deal",
  "contact",
  "crm_task",
  "task",
  "event",
  "transaction",
  "recurring_payment",
] as const;
export type TrashKind = (typeof TRASH_KINDS)[number];

/** Days the trash keeps what was deleted, unless the administration sets otherwise. */
export const TRASH_RETENTION_DEFAULT = 7;
export const TRASH_RETENTION_MIN = 1;
export const TRASH_RETENTION_MAX = 90;

export function isTrashKind(value: unknown): value is TrashKind {
  return typeof value === "string" && (TRASH_KINDS as readonly string[]).includes(value);
}

/** The deleting tools whose rows go to the trash as snapshots, and the kind of each. */
export const SNAPSHOT_TOOLS: Record<string, { kind: TrashKind; table: UndoTable }> = {
  delete_task: { kind: "task", table: "tasks" },
  delete_crm_task: { kind: "crm_task", table: "crm_tasks" },
  delete_event: { kind: "event", table: "calendar_events" },
  delete_transaction: { kind: "transaction", table: "transactions" },
  delete_recurring_payment: { kind: "recurring_payment", table: "recurring_payments" },
};

export type TrashEntry = {
  kind: TrashKind;
  recordId: string;
  title: string | null;
  records: UndoRecord[];
};

function titleOf(row: Record<string, Json> | undefined): string | null {
  const value = row?.title ?? row?.description ?? row?.name ?? null;
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
}

/**
 * The trash entries of one change: per deleting tool, its main row (the
 * deleted row of its table, e.g. the task above its subtasks) with all the
 * records the tool deleted, so restoring brings back the whole thing.
 */
export function trashEntriesOf(tool: string, records: readonly UndoRecord[]): TrashEntry[] {
  const def = SNAPSHOT_TOOLS[tool];
  if (!def) return [];
  const deleted = records.filter((record) => record.op === "delete");
  const main = deleted.find((record) => record.table === def.table);
  const id = main?.match.id;
  if (!main || typeof id !== "string") return [];
  return [{ kind: def.kind, recordId: id, title: titleOf(main.row), records: [...deleted] }];
}

/** Until when an item can be restored. */
export function restorableUntil(deletedAt: string, days: number): string {
  return new Date(Date.parse(deletedAt) + days * 24 * 60 * 60 * 1000).toISOString();
}

export function validRetention(days: unknown): days is number {
  return (
    typeof days === "number" &&
    Number.isInteger(days) &&
    days >= TRASH_RETENTION_MIN &&
    days <= TRASH_RETENTION_MAX
  );
}
