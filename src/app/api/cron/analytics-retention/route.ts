import { runCron } from "@/lib/analytics/instrument";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Daily: deletes analytics events, app sessions and old usage rows older than
 * 13 months (purge_analytics() keeps the cut-off in one place).
 */
export function GET(request: Request) {
  return runCron("analytics_retention", request, async () => {
    const { data, error } = await createAdminClient().rpc("purge_analytics");
    if (error) throw error;
    const removed = data?.[0] ?? { events: 0, sessions: 0, usage: 0, keywords: 0 };
    return {
      processed: removed.events + removed.sessions + removed.usage + removed.keywords,
      body: removed,
    };
  });
}
