import { z } from "zod";
import { isTrashKind, restorableUntil, type TrashKind } from "@/features/trash/trash";
import { undoRecords, type UndoRecord, type UndoResult, type UndoTable } from "../records";
import { defineTool, ToolError, type ToolContext } from "../types";
import { hrefs, uuid } from "./shared";

/**
 * The trash (28.8): what Grady and connected apps deleted comes back from
 * here within the retention the administration sets. Deals and contacts wait
 * with deleted_at (trash_record() / trash_restore_record()); other rows as
 * their Undo records, inserted again with the user's own client.
 */

/** A deal or a contact into the trash, through the database's check of the delete right. */
export async function trashRecord(ctx: ToolContext, kind: "deal" | "contact", id: string) {
  const { error } = await ctx.db.rpc("trash_record", { _kind: kind, _id: id });
  if (error) throw error;
}

/** The record of a trashed deal or contact: Undo restores it from the trash. */
export function trashed(table: Extract<UndoTable, "deals" | "contacts">, id: string): UndoRecord {
  return { table, match: { id }, op: "update", before: {}, after: {}, stamp: null };
}

export async function restoreTrashed(
  ctx: ToolContext,
  kind: "deal" | "contact",
  records: UndoRecord[],
): Promise<UndoResult> {
  const id = records[0]?.match.id;
  if (typeof id !== "string") return { ok: false, reason: "gone" };
  const { error } = await ctx.db.rpc("trash_restore_record", { _kind: kind, _id: id });
  if (error) return { ok: false, reason: error.code === "P0002" ? "gone" : "failed" };
  return { ok: true };
}

function hrefOf(kind: TrashKind, id: string): string | null {
  switch (kind) {
    case "deal":
      return hrefs.deal(id);
    case "contact":
      return hrefs.contact(id);
    case "crm_task":
      return hrefs.crmTask(id);
    case "event":
      return hrefs.event(id);
    case "transaction":
      return hrefs.transactions;
    case "recurring_payment":
      return hrefs.recurring;
    case "task":
      return null;
  }
}

async function retentionDays(ctx: ToolContext): Promise<number> {
  const { data } = await ctx.db.rpc("trash_retention_days");
  return typeof data === "number" && data > 0 ? data : 7;
}

export const trashTools = [
  defineTool({
    name: "list_trash",
    section: "dashboard",
    action: null,
    kind: "read",
    risk: "instant",
    description:
      "What the user deleted through Grady or a connected app and can still restore (newest first, 25 at a time; offset for more): kind, title, when, until when it can be restored.",
    input: z.object({ offset: z.number().int().min(0).max(5000).optional() }),
    describe: (_input, t) => t("list_trash"),
    async execute(ctx, input) {
      const offset = input.offset ?? 0;
      const [{ data, error, count }, days] = await Promise.all([
        ctx.db
          .from("trash_items")
          .select("id, kind, title, via, deleted_at", { count: "exact" })
          .eq("user_id", ctx.userId)
          .eq("space_id", ctx.workspaceId)
          .is("restored_at", null)
          .order("deleted_at", { ascending: false })
          .range(offset, offset + 24),
        retentionDays(ctx),
      ]);
      if (error) throw error;
      return {
        output: {
          items: (data ?? []).map((row) => ({
            trashId: row.id,
            kind: row.kind,
            title: row.title,
            via: row.via,
            deletedAt: row.deleted_at,
            restorableUntil: restorableUntil(row.deleted_at, days),
          })),
          total: count ?? data?.length ?? 0,
          offset,
          retentionDays: days,
        },
      };
    },
    undoable: false,
    invalidates: [],
  }),

  defineTool({
    name: "restore_from_trash",
    section: "dashboard",
    action: null,
    kind: "write",
    risk: "instant",
    description:
      "Restore something the user deleted through Grady or a connected app (trashId from list_trash), as it was, with the user's current rights.",
    input: z.object({ trashId: uuid }),
    describe: (_input, t) => t("restore_from_trash", { title: "" }),
    async execute(ctx, input) {
      const { data: item, error } = await ctx.db
        .from("trash_items")
        .select("id, kind, record_id, title, records, restored_at, space_id")
        .eq("id", input.trashId)
        .eq("user_id", ctx.userId)
        .maybeSingle();
      if (error && error.code !== "22P02") throw error;
      if (!item || item.restored_at || item.space_id !== ctx.workspaceId || !isTrashKind(item.kind))
        throw new ToolError("notFound");
      if (item.kind === "deal" || item.kind === "contact") {
        const restored = await ctx.db.rpc("trash_restore_record", {
          _kind: item.kind,
          _id: item.record_id,
        });
        if (restored.error) throw restored.error;
      } else {
        const records = (Array.isArray(item.records)
          ? item.records
          : []) as unknown as UndoRecord[];
        const outcome = await undoRecords(ctx.db, records);
        if (!outcome.ok) throw new ToolError(outcome.reason === "changed" ? "changed" : "failed");
        const marked = await ctx.db.rpc("trash_mark_restored", { _id: item.id });
        if (marked.error) throw marked.error;
      }
      ctx.track("trash_restored", { kind: item.kind, via: "tool" });
      return {
        output: { restored: true, kind: item.kind, id: item.record_id },
        summary: ctx.t("restore_from_trash", { title: item.title ?? "" }),
        href: hrefOf(item.kind, item.record_id),
      };
    },
    undoable: false,
    invalidates: ["pipeline", "contacts", "crmTasks", "calendar", "finance", "milestones"],
  }),
];
