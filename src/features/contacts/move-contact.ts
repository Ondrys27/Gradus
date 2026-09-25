import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { AnswerValue } from "./move-form";

export type MoveContactInput = {
  contactId: string;
  tableId: string;
  /** Keyed by question id; the database keeps only answers of questions shown. */
  answers: Record<string, AnswerValue>;
};

/**
 * The only way a contact changes table. The database function updates
 * contact_table_entries, records contact_table_moves and the move activity, and
 * books a calendar meeting when the table asks for one. Cold calling uses it too.
 */
export async function moveContact(
  supabase: SupabaseClient<Database>,
  { contactId, tableId, answers }: MoveContactInput,
) {
  const { data, error } = await supabase.rpc("move_contact", {
    _contact_id: contactId,
    _to_table_id: tableId,
    _answers: answers,
  });
  if (error) throw error;
  return data;
}
