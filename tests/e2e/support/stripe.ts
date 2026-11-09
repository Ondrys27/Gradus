import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import Stripe from "stripe";
import type { Account } from "./accounts";
import { env } from "./env";

/**
 * Synthetic Stripe events for the end-to-end tests (steps 23.1 and 23.2):
 * objects shaped as Stripe's, events signed with the test
 * STRIPE_WEBHOOK_SECRET (evt_e2e_…, test mode), which the webhook takes as
 * they are outside production and only for e2e-…@gradus.local accounts.
 */

export const DAY = 86_400;

export const secret = env("STRIPE_WEBHOOK_SECRET");
export const tag = () => randomUUID().replace(/-/g, "").slice(0, 16);

export function subscriptionObject(account: Account, id: string, status: string, now: number) {
  return {
    id,
    object: "subscription",
    status,
    customer: `cus_e2e_${tag()}`,
    livemode: false,
    cancel_at_period_end: false,
    cancel_at: null,
    trial_end: null,
    schedule: null,
    metadata: { workspace: account.id, plan: "pro", billing: "monthly" },
    items: {
      object: "list",
      data: [
        {
          id: `si_e2e_${tag()}`,
          object: "subscription_item",
          quantity: 1,
          current_period_start: now,
          current_period_end: now + 30 * DAY,
          price: {
            id: `price_e2e_${tag()}`,
            object: "price",
            currency: "czk",
            unit_amount: 89000,
            lookup_key: "plan:pro:CZK:monthly:v1",
            metadata: {},
          },
        },
      ],
    },
  };
}

export function invoiceObject(subscription: ReturnType<typeof subscriptionObject>, paid: boolean, now: number) {
  return {
    id: `in_e2e_${tag()}`,
    object: "invoice",
    status: paid ? "paid" : "open",
    livemode: false,
    currency: "czk",
    amount_due: 89000,
    amount_paid: paid ? 89000 : 0,
    attempt_count: 1,
    hosted_invoice_url: "https://invoice.stripe.com/i/e2e/receipt",
    total_taxes: [],
    status_transitions: { paid_at: paid ? now : null, finalized_at: now, marked_uncollectible_at: null, voided_at: null },
    parent: {
      type: "subscription_details",
      quote_details: null,
      subscription_details: { subscription, metadata: subscription.metadata },
    },
  };
}

export async function send(
  request: APIRequestContext,
  type: string,
  object: unknown,
  created: number,
  id = `evt_e2e_${tag()}`,
) {
  const payload = JSON.stringify({
    id,
    object: "event",
    api_version: "2026-10-28.endive",
    created,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
    data: { object },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: secret as string });
  const response = await request.post("/api/stripe/webhook", {
    data: payload,
    headers: { "stripe-signature": signature, "content-type": "application/json" },
  });
  return { status: response.status(), body: (await response.json()) as { outcome?: string }, id };
}

