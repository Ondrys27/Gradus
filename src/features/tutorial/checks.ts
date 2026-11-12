import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { signalSince, type TutorialSignal } from "./signals";

/**
 * How the tutorial knows a hands-on step is done: a row the user made (or
 * changed) after the tutorial began, read through their own client (RLS), or
 * a signal from the screen. Rows of the sample data never count as made by
 * the user: they are filtered out where the step asks for the user's own.
 */

export type CheckTable =
  | "milestones"
  | "tasks"
  | "notes"
  | "contacts"
  | "contact_table_moves"
  | "deals"
  | "deal_events"
  | "crm_tasks"
  | "invoices"
  | "jarvis_messages";

export type CheckFilter =
  | { column: string; op: "eq"; value: string | boolean }
  | { column: string; op: "isNull" | "notNull" };

export type TutorialCheck =
  | {
      kind: "row";
      table: CheckTable;
      /** The time column that must be later than the start. */
      since: string;
      /** Only the user's own rows, never the samples (tables with is_demo). */
      realOnly?: boolean;
      /** Whose rows: the space (user_id = workspace) or the account itself (Grady's chat). */
      owner?: "workspace" | "user";
      where?: CheckFilter[];
    }
  | { kind: "signal"; signal: TutorialSignal };

export const TUTORIAL_CHECKS = {
  milestoneCreated: { kind: "row", table: "milestones", since: "created_at", realOnly: true },
  taskCreated: { kind: "row", table: "tasks", since: "created_at", realOnly: true },
  taskMoved: { kind: "signal", signal: "taskMoved" },
  // A new note or the sample note filled in; its updated_at moves only with the text.
  noteWritten: {
    kind: "row",
    table: "notes",
    since: "updated_at",
    where: [{ column: "deleted_at", op: "isNull" }],
  },
  contactCreated: { kind: "row", table: "contacts", since: "created_at", realOnly: true },
  contactMoved: { kind: "row", table: "contact_table_moves", since: "created_at" },
  dealCreated: { kind: "row", table: "deals", since: "created_at", realOnly: true },
  closeDateSet: {
    kind: "row",
    table: "deal_events",
    since: "occurred_at",
    where: [{ column: "kind", op: "eq", value: "close_date" }],
  },
  dealTaskCreated: {
    kind: "row",
    table: "crm_tasks",
    since: "created_at",
    realOnly: true,
    where: [{ column: "deal_id", op: "notNull" }],
  },
  crmTaskDone: {
    kind: "row",
    table: "crm_tasks",
    since: "completed_at",
    where: [{ column: "status", op: "eq", value: "done" }],
  },
  invoiceCreated: {
    kind: "row",
    table: "invoices",
    since: "created_at",
    where: [{ column: "kind", op: "eq", value: "invoice" }],
  },
  gradyAsked: {
    kind: "row",
    table: "jarvis_messages",
    since: "created_at",
    owner: "user",
    where: [{ column: "role", op: "eq", value: "user" }],
  },
  gradyFrequency: { kind: "signal", signal: "gradyFrequency" },
} as const satisfies Record<string, TutorialCheck>;

export type TutorialCheckKey = keyof typeof TUTORIAL_CHECKS;

export type CheckContext = {
  /** The space the user works in (their own account for the full tutorial). */
  workspaceId: string;
  userId: string;
  /** When the tutorial (or the step) began: only what came later counts. */
  since: string;
};

export type QueryFilter =
  | ["eq", string, string | boolean]
  | ["gt", string, string]
  | ["is", string, null]
  | ["not.is", string, null];

/** The read a row check makes: one table, every filter ANDed, only a count. */
export function checkQuery(
  check: Extract<TutorialCheck, { kind: "row" }>,
  context: CheckContext,
): { table: CheckTable; filters: QueryFilter[] } {
  const filters: QueryFilter[] = [
    ["eq", "user_id", check.owner === "user" ? context.userId : context.workspaceId],
    ["gt", check.since, context.since],
  ];
  if (check.realOnly) filters.push(["eq", "is_demo", false]);
  for (const filter of check.where ?? []) {
    if (filter.op === "eq") filters.push(["eq", filter.column, filter.value]);
    else if (filter.op === "isNull") filters.push(["is", filter.column, null]);
    else filters.push(["not.is", filter.column, null]);
  }
  return { table: check.table, filters };
}

/** Whether the step is done. A failed read counts as not yet (the next poll tries again). */
export async function runCheck(
  check: TutorialCheck,
  context: CheckContext,
  client: SupabaseClient<Database>,
): Promise<boolean> {
  if (check.kind === "signal") return signalSince(check.signal, Date.parse(context.since));
  const { table, filters } = checkQuery(check, context);
  // The table and its columns come from TUTORIAL_CHECKS, typed loosely on purpose.
  let query = client.from(table as "milestones").select("id", { count: "exact", head: true });
  for (const [op, column, value] of filters) {
    const name = column as "id";
    if (op === "eq") query = query.eq(name, value as string);
    else if (op === "gt") query = query.gt(name, value);
    else if (op === "is") query = query.is(name, null);
    else query = query.not(name, "is", null);
  }
  const { count, error } = await query;
  if (error) return false;
  return (count ?? 0) > 0;
}
