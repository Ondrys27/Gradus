import { runCron } from "@/lib/analytics/instrument";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Daily: notes that have been in Recently Deleted for 30 days are removed for
 * good (purge_deleted_notes() keeps the cut-off in one place).
 */
export function GET(request: Request) {
  return runCron("notes_trash", request, async () => {
    const { data, error } = await createAdminClient().rpc("purge_deleted_notes");
    if (error) throw error;
    const removed = data ?? 0;
    return { processed: removed, body: { removed } };
  });
}
