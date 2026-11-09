import { reconcileStripeSubscriptions } from "@/features/billing/stripe/reconcile";
import { runCron } from "@/lib/analytics/instrument";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Daily "automatic payments": the recurring payments of Finance that came due
 * (post_due_recurring_payments(): one transaction per due day in each user's
 * own time zone, so running it twice books nothing twice), then the
 * reconciliation with Stripe (step 23.1): the running subscriptions in Stripe
 * read again and any difference a missed webhook left fixed, at most 200 a
 * run, with the extra workers' count for the next period.
 */
export function GET(request: Request) {
  return runCron("recurring_payments", request, async () => {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("post_due_recurring_payments");
    if (error) throw error;
    const stripe = await reconcileStripeSubscriptions(admin);
    return {
      processed: (data ?? 0) + stripe.checked,
      body: { booked: data, stripe },
    };
  });
}
