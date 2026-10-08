import { runCron } from "@/lib/analytics/instrument";
import { daysToRefresh } from "@/lib/analytics/metrics";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Nightly: stores yesterday's daily metrics (and the day before, for events
 * that arrived late) in metrics_daily for the common segments, so the
 * administration reads a year of them at once. Today is always computed live.
 * Protected by CRON_SECRET through runCron().
 */
export function GET(request: Request) {
  return runCron("metrics_daily", request, async () => {
    const admin = createAdminClient();
    let rows = 0;
    for (const day of daysToRefresh()) {
      const { data, error } = await admin.rpc("refresh_metrics_daily", { _day: day });
      if (error) throw error;
      rows += data ?? 0;
    }
    return { processed: rows, body: { rows } };
  });
}
