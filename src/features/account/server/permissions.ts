import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GrantAction, GrantSection } from "@/features/workers/permissions-catalog";
import type { Database } from "@/types/database";

/**
 * The server's useCan: asks the database (has_permission) with the user's own
 * client, so the answer is the one RLS and the functions apply. The owner of
 * the space always may; a worker by the grants of the catalog.
 */
export async function serverCan<S extends GrantSection>(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  section: S,
  action: GrantAction<S>,
): Promise<boolean> {
  const args: { _owner: string; _section: string; _action: string } = {
    _owner: workspaceId,
    _section: section,
    _action: action,
  };
  const { data, error } = await supabase.rpc("has_permission", args);
  if (error) throw error;
  return data === true;
}
