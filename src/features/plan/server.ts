import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Whether the workspace's trial has ended, asked with the caller's own client.
 * The database trigger already refuses a signed-in user's writes; this guards
 * server actions whose side effects happen outside the database first
 * (an e-mail through Resend, an invoice in Fakturoid) or that write with the
 * admin client. When the plan cannot be read, the action is refused too.
 */
export async function isWorkspaceReadOnly(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("current_plan", { _user_id: workspaceId });
  if (error) {
    console.error("current_plan failed", error);
    return true;
  }
  return Boolean(data?.[0]?.read_only);
}
