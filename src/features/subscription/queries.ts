"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { planKeys } from "@/features/plan/queries";
import { startCheckout, type CheckoutInput } from "@/features/billing/stripe/actions";
import { createClient } from "@/lib/supabase/client";
import {
  cancelSubscription,
  loadPlanUsage,
  loadWorkerBilling,
  requestSubscriptionChange,
  resumeSubscription,
  saveBillingProfile,
} from "./actions";
import type { SubscriptionErrorCode, SubscriptionResult } from "./server-context";
import {
  BILLING_PROFILE_COLUMNS,
  type BillingProfile,
  type BillingProfileInput,
  type CancelInput,
  type PlanChoiceInput,
} from "./schemas";
import { SUBSCRIPTION_COLUMNS, toSubscription, type Subscription } from "./state";

/** Rows of the payment history; a gateway adds one a month, so this is years. */
export const PAYMENTS_LIMIT = 36;

export const subscriptionKeys = {
  all: (userId: string) => ["account", userId, "subscription"] as const,
  subscription: (userId: string) => [...subscriptionKeys.all(userId), "row"] as const,
  payments: (userId: string) => [...subscriptionKeys.all(userId), "payments"] as const,
  billing: (userId: string) => [...subscriptionKeys.all(userId), "billing"] as const,
  usage: (userId: string) => [...subscriptionKeys.all(userId), "usage"] as const,
  workers: (userId: string) => [...subscriptionKeys.all(userId), "workers"] as const,
};

export class SubscriptionActionError extends Error {
  constructor(readonly code: SubscriptionErrorCode) {
    super(code);
  }
}

function unwrap<T>(result: SubscriptionResult<T>): T {
  if (!result.ok) throw new SubscriptionActionError(result.error);
  return result.data;
}

/**
 * The account's own subscription (RLS: read own only), or null without one.
 * Right after a Checkout the webhook may still be on its way: `poll` reads it
 * again every few seconds until the row follows Stripe.
 */
export function useSubscription({ poll = false, enabled = true }: { poll?: boolean; enabled?: boolean } = {}) {
  const { user } = useSession();
  return useQuery({
    queryKey: subscriptionKeys.subscription(user.id),
    enabled,
    refetchInterval: (query) =>
      poll && query.state.dataUpdateCount < 12 && query.state.data?.gateway !== "stripe" ? 3_000 : false,
    queryFn: async (): Promise<Subscription | null> => {
      const { data, error } = await createClient()
        .from("subscriptions")
        .select(SUBSCRIPTION_COLUMNS)
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data ? toSubscription(data) : null;
    },
  });
}

export type Payment = {
  id: string;
  amount: number;
  currency: string;
  paidAt: string;
  status: "paid" | "failed" | "refunded";
  invoiceUrl: string | null;
};

export function usePayments() {
  const { user } = useSession();
  return useQuery({
    queryKey: subscriptionKeys.payments(user.id),
    queryFn: async (): Promise<Payment[]> => {
      const { data, error } = await createClient()
        .from("payments")
        .select("id, amount, currency, paid_at, status, invoice_url")
        .eq("user_id", user.id)
        .order("paid_at", { ascending: false })
        .limit(PAYMENTS_LIMIT);
      if (error) throw error;
      return data.map((row) => ({
        id: row.id,
        amount: Number(row.amount),
        currency: row.currency,
        paidAt: row.paid_at,
        status: row.status === "failed" || row.status === "refunded" ? row.status : "paid",
        invoiceUrl: row.invoice_url,
      }));
    },
  });
}

export type BillingDetails = {
  profile: BillingProfile | null;
  /** From the supplier's details on invoices, until the user saves their own. */
  prefill: BillingProfile | null;
};

/** The saved billing details, or what the invoices' supplier details suggest. */
export function useBillingDetails() {
  const { user } = useSession();
  return useQuery({
    queryKey: subscriptionKeys.billing(user.id),
    queryFn: async (): Promise<BillingDetails> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("billing_profiles")
        .select(BILLING_PROFILE_COLUMNS)
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      if (data) return { profile: data, prefill: null };
      const { data: invoice, error: invoiceError } = await supabase
        .from("invoice_profiles")
        .select(BILLING_PROFILE_COLUMNS)
        .eq("user_id", user.id)
        .maybeSingle();
      if (invoiceError) throw invoiceError;
      return { profile: null, prefill: invoice ?? null };
    },
  });
}

/** What the account holds now, for the downgrade warning. Read when the change dialog opens. */
export function usePlanUsage(enabled: boolean) {
  const { user } = useSession();
  return useQuery({
    queryKey: subscriptionKeys.usage(user.id),
    queryFn: async () => unwrap(await loadPlanUsage()),
    enabled,
    staleTime: 60_000,
  });
}

/**
 * Who pays for the owner's workers: the plan's terms and, per worker, whether
 * they hold a plan of their own. Only the owner in their own space has it.
 */
export function useWorkerBilling(enabled = true) {
  const { user } = useSession();
  return useQuery({
    queryKey: subscriptionKeys.workers(user.id),
    queryFn: async () => unwrap(await loadWorkerBilling()),
    enabled,
    staleTime: 60_000,
  });
}

/** After any change: the row, and the plan the whole app reads (limits, read-only). */
function useRefresh() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.subscription(user.id) }),
      queryClient.invalidateQueries({ queryKey: planKeys.plan(user.id, user.id) }),
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.workers(user.id) }),
    ]);
}

export function useRequestChange() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (input: PlanChoiceInput) => unwrap(await requestSubscriptionChange(input)),
    onSettled: refresh,
  });
}

export function useCancelSubscription() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (input: CancelInput) => unwrap(await cancelSubscription(input)),
    onSettled: refresh,
  });
}

export function useResumeSubscription() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async () => unwrap(await resumeSubscription()),
    onSettled: refresh,
  });
}

/** Opens Stripe's Checkout: the browser leaves for Stripe's page. */
export function useStartCheckout() {
  return useMutation({
    mutationFn: async (input: CheckoutInput) => unwrap(await startCheckout(input)),
    onSuccess: ({ url }) => window.location.assign(url),
  });
}

export function useSaveBillingProfile() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BillingProfileInput) => unwrap(await saveBillingProfile(input)),
    onSuccess: (profile) =>
      queryClient.setQueryData<BillingDetails>(subscriptionKeys.billing(user.id), {
        profile,
        prefill: null,
      }),
  });
}
