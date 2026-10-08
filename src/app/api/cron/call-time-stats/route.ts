import { runCron } from "@/lib/analytics/instrument";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Daily rebuild of the shared "best time to call" statistics from every
 * account's moves. The work happens in refresh_call_time_stats(); the target
 * table has no link to any user.
 */
export function GET(request: Request) {
  return runCron("call_time_stats", request, async () => {
    const { data, error } = await createAdminClient().rpc("refresh_call_time_stats");
    if (error) throw error;
    return { processed: data ?? 0, body: { cells: data } };
  });
}
