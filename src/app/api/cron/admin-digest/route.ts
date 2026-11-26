import { runAdminDigest } from "@/features/admin/digest/server/send";
import { runCron } from "@/lib/analytics/instrument";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Daily at 2:00–2:59 UTC (Vercel Hobby runs it once within that hour), after
 * the daily metrics: yesterday's summary to every administrator, handed to
 * Resend for their own hour (6:00 by default) or sent at once where that
 * hour has passed (admin-digest, 30.1).
 */
export function GET(request: Request) {
  return runCron("admin_digest", request, async () => {
    const run = await runAdminDigest();
    return { processed: run.scheduled + run.sent, body: run };
  });
}
