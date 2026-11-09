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

export type AdminPayment = {
  id: string;
  paidAt: string;
  amount: number;
  currency: string;
  status: "paid" | "failed" | "refunded";
  planKey: string | null;
  invoiceUrl: string | null;
  invoiceRef: string | null;
  mode: "test" | "live";
};

export type AdminStripeLink = {
  /** The mode of the linked subscription, or of the only customer. */
  mode: "test" | "live" | null;
  subscriptionRef: string | null;
  customers: { mode: "test" | "live"; id: string }[];
  payments: AdminPayment[];
};

const asMode = (value: string | null | undefined): "test" | "live" | null =>
  value === "test" || value === "live" ? value : null;

/** The account's Stripe side for the administration: customer, subscription, the last payments. */
export async function loadUserStripe(userId: string, limit = 5): Promise<AdminStripeLink> {
  const admin = createAdminClient();
  const [sub, customers, payments] = await Promise.all([
    admin.from("subscriptions").select("provider, provider_ref, stripe_mode").eq("user_id", userId).maybeSingle(),
    admin.from("billing_customers").select("stripe_mode, stripe_customer_id").eq("user_id", userId),
    admin
      .from("payments")
      .select("id, paid_at, amount, currency, status, plan_key, invoice_url, provider_ref, stripe_mode")
      .eq("user_id", userId)
      .order("paid_at", { ascending: false })
      .limit(limit),
  ]);
  for (const { error } of [sub, customers, payments]) {
    if (error) throw new Error(`stripe link: ${error.message}`);
  }
  const linked = sub.data?.provider === "stripe" ? sub.data : null;
  const customerList = (customers.data ?? []).flatMap((row) => {
    const mode = asMode(row.stripe_mode);
    return mode ? [{ mode, id: row.stripe_customer_id }] : [];
  });
  return {
    mode: asMode(linked?.stripe_mode) ?? (customerList.length === 1 ? customerList[0]!.mode : null),
    subscriptionRef: linked?.provider_ref ?? null,
    customers: customerList,
    payments: (payments.data ?? []).map((row) => ({
      id: row.id,
      paidAt: row.paid_at,
      amount: Number(row.amount),
      currency: row.currency,
      status: row.status === "failed" || row.status === "refunded" ? row.status : "paid",
      planKey: row.plan_key,
      invoiceUrl: row.invoice_url,
      invoiceRef: row.provider_ref,
      mode: asMode(row.stripe_mode) ?? "test",
    })),
  };
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
