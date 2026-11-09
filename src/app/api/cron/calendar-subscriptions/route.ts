import { refreshDueSubscriptions } from "@/features/scheduler/server/subscriptions";
import { runCron } from "@/lib/analytics/instrument";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Daily: downloads the subscribed calendars again (the ones fetched longest
 * ago first, a batch at a time), so the busy times reach 60 days ahead even
 * when nobody opens the booking page.
 */
export function GET(request: Request) {
  return runCron("calendar_subscriptions", request, async () => {
    const summary = await refreshDueSubscriptions(createAdminClient());
    return { processed: summary.ok + summary.failed, body: summary };
  });
}
