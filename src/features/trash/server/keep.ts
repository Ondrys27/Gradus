import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UndoRecord } from "@/features/grady/tools/records";
import type { Database, Json } from "@/types/database";
import { trashEntriesOf } from "../trash";

type Admin = SupabaseClient<Database>;

/**
 * Keeps what a deleting tool removed (its Undo records) in the trash. Written
 * by the server with the admin client, always for the session's user and the
 * space the change was made in; a failure only goes to the log (the deletion
 * itself is done, and Grady's card can still take it back for 24 hours).
 */
export async function keepInTrash(
  admin: Admin,
  who: { userId: string; spaceId: string },
  tool: string,
  records: readonly UndoRecord[],
  via: "grady" | "mcp",
): Promise<void> {
  const entries = trashEntriesOf(tool, records);
  if (!entries.length) return;
  const { error } = await admin.from("trash_items").insert(
    entries.map((entry) => ({
      user_id: who.userId,
      space_id: who.spaceId,
      kind: entry.kind,
      record_id: entry.recordId,
      title: entry.title,
      via,
      records: entry.records as unknown as Json,
    })),
  );
  if (error) console.error("trash: keeping a deletion failed", error.message);
}

/** Grady's Undo brought rows back: their trash items are restored too. */
export async function markRestored(
  admin: Admin,
  userId: string,
  records: readonly UndoRecord[],
): Promise<void> {
  const ids = records
    .filter((record) => record.op === "delete" && typeof record.match.id === "string")
    .map((record) => record.match.id as string);
  if (!ids.length) return;
  const { error } = await admin
    .from("trash_items")
    .update({ restored_at: new Date().toISOString() })
    .eq("user_id", userId)
    .in("record_id", ids)
    .is("restored_at", null);
  if (error) console.error("trash: marking restored failed", error.message);
}
