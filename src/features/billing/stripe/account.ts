import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { SubscriptionError } from "@/features/subscription/server-context";
import { SUBSCRIPTION_COLUMNS, toSubscription, type Subscription } from "@/features/subscription/state";
import type { Database } from "@/types/database";
import { logPaymentRefused, stripeClient } from "./client";
import type { GatewayContext } from "./gateway";
import { accountAllowedInMode, type StripeMode } from "./modes";

/**
 * The Stripe side of one owner's request: the SDK in this deployment's mode,
 * only when that mode may change this account (test: internal and
 * @gradus.local, live: the others). Anything else refuses with a clear line
 * in the log and `paymentsUnavailable` for the page.
 */

type Admin = SupabaseClient<Database>;

export async function isInternalAccount(admin: Admin, userId: string): Promise<boolean> {
  const { data, error } = await admin.from("profiles").select("is_internal").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data?.is_internal ?? false;
}

export async function gatewayFor(ctx: { admin: Admin; userId: string; email: string | null }): Promise<GatewayContext> {
  const client = stripeClient();
  if (!client) {
    logPaymentRefused("payments are not set up in this deployment", null);
    throw new SubscriptionError("paymentsUnavailable");
  }
  const internal = await isInternalAccount(ctx.admin, ctx.userId);
  if (!accountAllowedInMode(client.mode, { email: ctx.email, internal })) {
    logPaymentRefused(
      client.mode === "test"
        ? "the test mode changes only internal and @gradus.local accounts"
        : "the live mode never changes internal or @gradus.local accounts",
      client.mode,
    );
    throw new SubscriptionError("paymentsUnavailable");
  }
  return { stripe: client.stripe, mode: client.mode, admin: ctx.admin, workspace: ctx.userId };
}

export type StoredSubscription = Subscription & { providerRef: string | null; stripeMode: StripeMode | null };

/** The workspace's own row, read by the server (with the Stripe link). */
export async function loadStoredSubscription(admin: Admin, userId: string): Promise<StoredSubscription | null> {
  const { data, error } = await admin
    .from("subscriptions")
    .select(`${SUBSCRIPTION_COLUMNS}, provider_ref, stripe_mode`)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    ...toSubscription(data),
    providerRef: data.provider_ref,
    stripeMode: data.stripe_mode === "test" || data.stripe_mode === "live" ? data.stripe_mode : null,
  };
}

/** A Stripe failure as the page's code; only its type and code go to the log. */
export async function viaStripe<T>(name: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError) {
      console.error(`[stripe] ${name} failed: ${error.type}${error.code ? ` ${error.code}` : ""}`);
      throw new SubscriptionError("gatewayFailed");
    }
    throw error;
  }
}
