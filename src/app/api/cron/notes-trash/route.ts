import { runCron } from "@/lib/analytics/instrument";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Daily: notes that have been in Recently Deleted for 30 days are removed for
 * good (purge_deleted_notes() keeps the cut-off in one place), and what Grady
 * or a connected app deleted once the trash's retention has passed
 * (purge_trash(), 7 days unless the administration says otherwise, 28.8).
 */
export function GET(request: Request) {
  return runCron("notes_trash", request, async () => {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("purge_deleted_notes");
    if (error) throw error;
    const removed = data ?? 0;
    const trash = await admin.rpc("purge_trash");
    if (trash.error) throw trash.error;
    return { processed: removed + (trash.data ?? 0), body: { removed, trash: trash.data ?? 0 } };
  });
}
