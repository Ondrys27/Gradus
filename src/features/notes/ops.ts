import type { OpsEnv } from "@/lib/ops";
import type { NoteDraft } from "./document";
import type { NoteTemplateKey } from "./templates";

/**
 * The writes of Notes, shared by the screens (the autosave, queries.ts,
 * link-queries.ts) and Grady's tools. Notes are always the account's own:
 * `userId` is the signed-in user, never a company. notes_guard keeps the
 * times; the trigger notes_sync_mentions keeps the links to records.
 */

/** A target a note can belong to (note_links: exactly one of them). */
export type NoteLinkTarget = { kind: "task" | "milestone" | "deal"; id: string };

/**
 * Writes a note's text. A note made in the app exists only in the browser
 * until its first save, so this updates and, when there is no row yet,
 * inserts (a parallel insert that won the race just means updating again).
 * Returns whether the row was new.
 */
export async function writeNote(
  env: Pick<OpsEnv, "db">,
  args: { userId: string; id: string; draft: NoteDraft },
): Promise<{ created: boolean }> {
  const text = {
    kind: args.draft.kind ?? "text",
    title: args.draft.title,
    content: args.draft.content as never,
    content_text: args.draft.content_text,
  };
  const update = () =>
    env.db.from("notes").update(text).eq("user_id", args.userId).eq("id", args.id).select("id");
  const updated = await update();
  if (updated.error) throw updated.error;
  if (updated.data.length > 0) return { created: false };
  const inserted = await env.db
    .from("notes")
    .insert({ id: args.id, user_id: args.userId, ...text });
  if (!inserted.error) return { created: true };
  if (inserted.error.code !== "23505") throw inserted.error;
  const again = await update();
  if (again.error) throw again.error;
  return { created: false };
}

export async function setNotePinned(
  env: Pick<OpsEnv, "db">,
  args: { userId: string; id: string; pinned: boolean },
): Promise<void> {
  const { error } = await env.db
    .from("notes")
    .update({ pinned: args.pinned })
    .eq("user_id", args.userId)
    .eq("id", args.id);
  if (error) throw error;
}

/** Moves a note to Recently Deleted (restorable for 30 days). */
export async function trashNote(
  env: OpsEnv,
  args: { userId: string; id: string; pinned: boolean; from?: "editor" | "list" | "keyboard" },
): Promise<void> {
  const { error } = await env.db
    .from("notes")
    .update({ deleted_at: new Date().toISOString() })
    .eq("user_id", args.userId)
    .eq("id", args.id);
  if (error) throw error;
  env.track("note_deleted", { pinned: args.pinned, ...(args.from ? { from: args.from } : {}) });
}

/** Ties a note to a task, milestone or deal; linking it twice is no error. */
export async function linkNote(
  env: OpsEnv,
  args: {
    noteId: string;
    target: NoteLinkTarget;
    how: "attach" | "write";
    template?: NoteTemplateKey | null;
  },
): Promise<{ id: string | null }> {
  const { data, error } = await env.db
    .from("note_links")
    .insert({
      note_id: args.noteId,
      task_id: args.target.kind === "task" ? args.target.id : null,
      milestone_id: args.target.kind === "milestone" ? args.target.id : null,
      deal_id: args.target.kind === "deal" ? args.target.id : null,
    })
    .select("id")
    .maybeSingle();
  if (error && error.code !== "23505") throw error;
  env.track("note_linked", {
    target: args.target.kind,
    how: args.how,
    ...(args.template ? { template: args.template } : {}),
  });
  return { id: data?.id ?? null };
}
