import "server-only";
import {
  isExpired,
  SUBSCRIPTION_COLUMNS,
  toSubscription,
  type Subscription,
} from "@/features/subscription/state";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Subscriptions for the administration, read with the admin client after
 * the page's guard (the table is the account's own for every client).
 */

export type AdminSubscription = Subscription & {
  expired: boolean;
  /** The user's own words when cancelling; shown to the administration only. */
  cancelNote: string | null;
};

export async function loadUserSubscription(userId: string): Promise<AdminSubscription | null> {
  const { data, error } = await createAdminClient()
    .from("subscriptions")
    .select(`${SUBSCRIPTION_COLUMNS}, cancel_note`)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`subscription: ${error.message}`);
  if (!data) return null;
  const subscription = toSubscription(data);
  return { ...subscription, expired: isExpired(subscription), cancelNote: data.cancel_note };
}

export type PlanUserCount = {
  planKey: string;
  accounts: number;
  trialing: number;
  cancelling: number;
  expired: number;
};

/** Accounts per plan key, internal ones left out (admin_plan_user_counts, server only). */
export async function loadPlanUserCounts(): Promise<PlanUserCount[]> {
  const { data, error } = await createAdminClient().rpc("admin_plan_user_counts");
  if (error) throw new Error(`plan user counts: ${error.message}`);
  return data.map((row) => ({
    planKey: row.plan_key,
    accounts: row.accounts,
    trialing: row.trialing,
    cancelling: row.cancelling,
    expired: row.expired,
  }));
}
