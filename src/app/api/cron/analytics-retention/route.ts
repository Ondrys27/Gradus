import { runCron } from "@/lib/analytics/instrument";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Daily: deletes analytics events, app sessions and old usage rows older than
 * 13 months (purge_analytics() keeps the cut-off in one place), and the
 * company activity older than 180 days (purge_activity_log(), 28.7), and the
 * MCP server's spent codes, tokens, counters, old calls and unused clients
 * (purge_mcp(), 28.8).
 */
export function GET(request: Request) {
  return runCron("analytics_retention", request, async () => {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("purge_analytics");
    if (error) throw error;
    const removed = data?.[0] ?? { events: 0, sessions: 0, usage: 0, keywords: 0 };
    const activity = await admin.rpc("purge_activity_log");
    if (activity.error) throw activity.error;
    const mcp = await admin.rpc("purge_mcp");
    if (mcp.error) throw mcp.error;
    return {
      processed:
        removed.events +
        removed.sessions +
        removed.usage +
        removed.keywords +
        (activity.data ?? 0) +
        (mcp.data ?? 0),
      body: { ...removed, activity: activity.data ?? 0, mcp: mcp.data ?? 0 },
    };
  });
}
