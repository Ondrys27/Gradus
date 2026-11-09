import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { isE2eTestAccount } from "@/features/auth/e2e-account";
import { runInBackground } from "@/features/errors/alerts/server/background";
import { captureServerError } from "@/features/errors/alerts/server/capture";
import { track } from "@/lib/analytics/track";
import type { Database } from "@/types/database";
import { recordOwnerAlert, sendOwnerDigest } from "../owner-alerts-server";
import type { StripeClient } from "./client";
import { paymentIntentOf } from "./mapping";
import {
  accountOf,
  applySubscriptionState,
  claimEvent,
  finishEvent,
  recordStripePayment,
} from "./store";
import type { AnalyticsCall, WebhookDeps } from "./webhook";

/**
 * The real I/O of processStripeEvent(): objects loaded from Stripe with the
 * configured key, writes through the billing functions with the admin
 * client. A synthetic end-to-end event (isSyntheticE2eEvent) brings its
 * objects along instead, so the test needs no network.
 */

type Admin = SupabaseClient<Database>;

const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : (value?.id ?? null);

class MissingObject extends Error {}

function embedded(event: Stripe.Event) {
  const object = event.data.object as unknown as {
    object?: string;
    id?: string;
    subscription?: unknown;
    parent?: { subscription_details?: { subscription?: unknown } | null } | null;
  };
  return object;
}

function syntheticLoaders(): Pick<WebhookDeps, "loadSubscription" | "loadSchedule" | "loadInvoice" | "invoiceOfCharge"> {
  return {
    loadSubscription: async (id, event) => {
      const object = embedded(event);
      const candidates = [object, object.subscription, object.parent?.subscription_details?.subscription];
      for (const candidate of candidates) {
        const sub = candidate as Stripe.Subscription | undefined;
        if (sub && typeof sub === "object" && sub.object === "subscription" && sub.id === id) return sub;
      }
      throw new MissingObject(`synthetic event without subscription ${id}`);
    },
    loadSchedule: async () => null,
    loadInvoice: async (id, event) => {
      const object = embedded(event) as unknown as Stripe.Invoice;
      if (object.object === "invoice" && object.id === id) return object;
      throw new MissingObject(`synthetic event without invoice ${id}`);
    },
    invoiceOfCharge: async (charge) => charge.metadata?.invoice ?? null,
  };
}

function stripeLoaders(stripe: Stripe): Pick<WebhookDeps, "loadSubscription" | "loadSchedule" | "loadInvoice" | "invoiceOfCharge"> {
  return {
    loadSubscription: (id) => stripe.subscriptions.retrieve(id),
    loadSchedule: (id) => stripe.subscriptionSchedules.retrieve(id, { expand: ["phases.items.price"] }),
    loadInvoice: (id) => stripe.invoices.retrieve(id),
    invoiceOfCharge: async (charge) => {
      const paymentIntent = paymentIntentOf(charge);
      if (!paymentIntent) return null;
      const payments = await stripe.invoicePayments.list({
        payment: { type: "payment_intent", payment_intent: paymentIntent },
        limit: 1,
      });
      return idOf(payments.data[0]?.invoice ?? null);
    },
  };
}

async function trackCall(admin: Admin, call: AnalyticsCall, workspace: string) {
  const options = { userId: workspace, ownerId: workspace, admin };
  switch (call.name) {
    case "checkout_completed":
      return void (await track("checkout_completed", call.props, options));
    case "payment_succeeded":
      return void (await track("payment_succeeded", call.props, options));
    case "payment_failed":
      return void (await track("payment_failed", call.props, options));
    case "payment_refunded":
      return void (await track("payment_refunded", call.props, options));
  }
}

export function webhookDeps(admin: Admin, client: StripeClient | null, synthetic: boolean): WebhookDeps {
  const loaders = synthetic ? syntheticLoaders() : client ? stripeLoaders(client.stripe) : null;
  const unavailable = async (): Promise<never> => {
    throw new Error("stripe webhook: no Stripe key to load the object with");
  };
  return {
    vercelEnv: process.env.VERCEL_ENV,
    keyMode: client?.mode ?? null,
    now: () => new Date(),
    claim: (event, mode) => claimEvent(admin, event, mode),
    finish: (event, outcome, workspace, detail) => finishEvent(admin, event.id, outcome, workspace, detail),
    loadSubscription: loaders?.loadSubscription ?? unavailable,
    loadSchedule: loaders?.loadSchedule ?? unavailable,
    loadInvoice: loaders?.loadInvoice ?? unavailable,
    invoiceOfCharge: loaders?.invoiceOfCharge ?? unavailable,
    account: (workspace) => accountOf(admin, workspace),
    isE2eAccount: (email) => !!email && isE2eTestAccount(email),
    applySubscription: (state, mode, eventAt) => applySubscriptionState(admin, state, mode, eventAt),
    recordPayment: (payment, status, workspace, mode, eventAt) =>
      recordStripePayment(admin, payment, status, workspace, mode, eventAt),
    track: (call, workspace) => trackCall(admin, call, workspace),
    alert: async (alert) => {
      try {
        if (await recordOwnerAlert(admin, alert)) {
          runInBackground("billing digest", () => sendOwnerDigest(admin));
        }
      } catch (error) {
        console.error("[billing] owner alert failed", error instanceof Error ? error.message : "unknown");
      }
    },
    report: (problem, context) =>
      captureServerError(new Error(`stripe webhook: ${problem}`), {
        source: "route",
        page: "/api/stripe/webhook",
        action: `stripe.${context.type}`,
        userId: context.workspace,
      }),
  };
}
