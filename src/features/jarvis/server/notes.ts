import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FormatSettings } from "@/lib/format";
import type { Database } from "@/types/database";
import { describeLinkedNotes, describeNotes, NOTES_CONTEXT_MAX_CHARS } from "../notes-context";

type Client = SupabaseClient<Database>;

/** Tasks of one milestone whose notes the review reads; this only bounds the query. */
const REVIEW_TASK_LIMIT = 500;
const REVIEW_LINK_LIMIT = 20;

/**
 * The notes block of a chat answer, read with the user's own client:
 * jarvis_notes() returns only the caller's notes (a worker's own, never the
 * owner's). The message picks the three best matching notes.
 */
export async function loadNotesContext(
  supabase: Client,
  message: string,
  settings: FormatSettings,
): Promise<string> {
  const { data, error } = await supabase.rpc("jarvis_notes", {
    _query: message,
    _body_chars: NOTES_CONTEXT_MAX_CHARS,
  });
  if (error) throw error;
  return describeNotes(data ?? [], settings);
}

/**
 * Notes tied to the milestone or any of its tasks, for the milestone review;
 * read with the user's own client, so RLS keeps it to their links and notes.
 */
export async function loadMilestoneNotes(supabase: Client, milestoneId: string): Promise<string> {
  const { data: tasks, error: tasksError } = await supabase
    .from("tasks")
    .select("id")
    .eq("milestone_id", milestoneId)
    .limit(REVIEW_TASK_LIMIT);
  if (tasksError) throw tasksError;
  const taskIds = (tasks ?? []).map((task) => task.id);
  const filter = taskIds.length
    ? `milestone_id.eq.${milestoneId},task_id.in.(${taskIds.join(",")})`
    : `milestone_id.eq.${milestoneId}`;
  const { data, error } = await supabase
    .from("note_links")
    .select("note:notes(id, title, content_text, deleted_at)")
    .or(filter)
    .order("created_at")
    .limit(REVIEW_LINK_LIMIT);
  if (error) throw error;
  const seen = new Set<string>();
  const notes = (data ?? []).flatMap(({ note }) => {
    if (!note || note.deleted_at || seen.has(note.id)) return [];
    seen.add(note.id);
    return [{ title: note.title, text: note.content_text }];
  });
  return describeLinkedNotes(notes);
}
