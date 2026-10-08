import { runCron } from "@/lib/analytics/instrument";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Daily booking of recurring payments that have come due. The work happens in
 * post_due_recurring_payments(): one transaction per due day in each user's own
 * time zone, so running it twice books nothing twice.
 */
export function GET(request: Request) {
  return runCron("recurring_payments", request, async () => {
    const { data, error } = await createAdminClient().rpc("post_due_recurring_payments");
    if (error) throw error;
    return { processed: data ?? 0, body: { booked: data } };
  });
}
