import { scheduleDueReminders } from "@/features/scheduler/server/bookings";
import { linkOrigin } from "@/features/scheduler/server/link";
import { refreshDueSubscriptions } from "@/features/scheduler/server/subscriptions";
import { runCron } from "@/lib/analytics/instrument";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Daily: downloads the subscribed calendars again (the ones fetched longest
 * ago first, a batch at a time), so the busy times reach 60 days ahead even
 * when nobody opens the booking page. Then the bookings (24.4): expired holds
 * and old visitor counts go, and reminders of meetings that were more than
 * 30 days ahead when booked are scheduled once they come into Resend's window.
 */
export function GET(request: Request) {
  return runCron("calendar_subscriptions", request, async () => {
    const admin = createAdminClient();
    const summary = await refreshDueSubscriptions(admin);
    const { data: holds, error } = await admin.rpc("scheduler_cleanup");
    if (error) throw error;
    const reminders = await scheduleDueReminders(admin, linkOrigin());
    return {
      processed: summary.ok + summary.failed + reminders.checked,
      body: { ...summary, expiredHolds: holds ?? 0, reminders },
    };
  });
}
