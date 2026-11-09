import type Stripe from "stripe";
import type { Billing, PaidPlanKey } from "@/config/pricing";
import type { StoredStatus } from "@/features/subscription/state";
import { fromMinorUnits, parseLookupKey, type PriceKey } from "./prices";

/**
 * Stripe's objects as the rows of Gradus (step 23.1), without any I/O: the
 * webhook and the daily reconciliation load the object from Stripe and
 * write what this says through billing_apply_subscription() /
 * billing_record_payment(). Every value is checked; what does not fit is a
 * problem, never a guess.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The workspace a Stripe object belongs to, from the metadata Gradus put there. */
export function workspaceOf(metadata: Stripe.Metadata | null | undefined): string | null {
  const value = metadata?.workspace;
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}

export const isWorkspaceId = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

const toIso = (unix: number | null | undefined) =>
  typeof unix === "number" && Number.isFinite(unix) && unix > 0 ? new Date(unix * 1000).toISOString() : null;

const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : (value?.id ?? null);

/**
 * Stripe's status as the stored one. unpaid (retries are over) and paused
 * still have a subscription that is not paid: past due. incomplete and
 * incomplete_expired never started (the first payment did not go through):
 * nothing to write, the trial or the expiry stays.
 */
export function storedStatusOf(status: Stripe.Subscription.Status): StoredStatus | null {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
    case "paused":
      return "past_due";
    case "canceled":
      return "cancelled";
    default:
      return null;
  }
}

/** Gradus's price behind a Stripe price: its lookup key, or the same in its metadata. */
export function priceKeyOf(price: string | Stripe.Price | null | undefined): PriceKey | null {
  if (!price || typeof price === "string") return null;
  const fromKey = parseLookupKey(price.lookup_key);
  if (fromKey) return fromKey;
  const meta = price.metadata ?? {};
  return parseLookupKey(
    meta.kind && meta.plan && meta.currency && meta.billing && meta.version
      ? `${meta.kind}:${meta.plan}:${meta.currency}:${meta.billing}:v${meta.version}`
      : null,
  );
}

export type SubscriptionState = {
  workspace: string;
  subscriptionRef: string;
  customerRef: string | null;
  planKey: PaidPlanKey;
  billing: Billing;
  status: StoredStatus;
  periodStart: string | null;
  periodEnd: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** A downgrade a Subscription Schedule holds for the end of the period. */
  scheduled: { planKey: PaidPlanKey; billing: Billing; at: string } | null;
  /** One period of plan and extra workers, before discounts. */
  amount: number | null;
  currency: string | null;
  planItemId: string;
  workerItem: { id: string; quantity: number } | null;
  /** The catalog version of the plan's price. */
  version: number;
};

export type SubscriptionProblem = "no_workspace" | "unknown_price" | "incomplete";

export type MappedSubscription =
  | { ok: true; state: SubscriptionState }
  | { ok: false; problem: SubscriptionProblem; workspace: string | null };

/** The plan of a schedule's later phase, when it differs from the one now. */
export function scheduledChange(
  schedule: Stripe.SubscriptionSchedule | null | undefined,
  current: { planKey: PaidPlanKey; billing: Billing },
  now: Date,
): SubscriptionState["scheduled"] {
  if (!schedule || (schedule.status !== "active" && schedule.status !== "not_started")) return null;
  const nowUnix = Math.floor(now.getTime() / 1000);
  const next = [...(schedule.phases ?? [])]
    .filter((phase) => phase.start_date > nowUnix)
    .sort((a, b) => a.start_date - b.start_date)[0];
  if (!next) return null;
  for (const item of next.items ?? []) {
    const key = priceKeyOf(item.price as string | Stripe.Price);
    if (key?.kind !== "plan") continue;
    if (key.plan === current.planKey && key.billing === current.billing) return null;
    const at = toIso(next.start_date);
    return at ? { planKey: key.plan, billing: key.billing, at } : null;
  }
  return null;
}

export function subscriptionState(
  sub: Stripe.Subscription,
  schedule: Stripe.SubscriptionSchedule | null = null,
  now: Date = new Date(),
): MappedSubscription {
  const workspace = workspaceOf(sub.metadata);
  if (!workspace) return { ok: false, problem: "no_workspace", workspace: null };
  const status = storedStatusOf(sub.status);
  if (!status) return { ok: false, problem: "incomplete", workspace };

  let plan: { item: Stripe.SubscriptionItem; key: PriceKey } | null = null;
  let worker: { item: Stripe.SubscriptionItem; key: PriceKey } | null = null;
  for (const item of sub.items?.data ?? []) {
    const key = priceKeyOf(item.price);
    if (key?.kind === "plan" && !plan) plan = { item, key };
    else if (key?.kind === "worker" && !worker) worker = { item, key };
  }
  if (!plan) return { ok: false, problem: "unknown_price", workspace };

  const unit = (item: Stripe.SubscriptionItem) =>
    typeof item.price.unit_amount === "number" ? item.price.unit_amount * (item.quantity ?? 1) : null;
  const planAmount = unit(plan.item);
  const workerAmount = worker ? unit(worker.item) : 0;
  const amount =
    planAmount === null || workerAmount === null ? null : fromMinorUnits(planAmount + workerAmount);
  const current = { planKey: plan.key.plan, billing: plan.key.billing };

  return {
    ok: true,
    state: {
      workspace,
      subscriptionRef: sub.id,
      customerRef: idOf(sub.customer),
      ...current,
      status,
      periodStart: toIso(plan.item.current_period_start),
      periodEnd: toIso(plan.item.current_period_end),
      trialEnd: toIso(sub.trial_end),
      cancelAtPeriodEnd: status !== "cancelled" && (sub.cancel_at_period_end || sub.cancel_at !== null),
      scheduled: status === "cancelled" ? null : scheduledChange(schedule, current, now),
      amount,
      currency: plan.item.price.currency ? plan.item.price.currency.toUpperCase() : null,
      planItemId: plan.item.id,
      workerItem: worker ? { id: worker.item.id, quantity: worker.item.quantity ?? 0 } : null,
      version: plan.key.version,
    },
  };
}

// ---------------------------------------------------------------------------
// Invoices and charges
// ---------------------------------------------------------------------------

export type PaymentStatus = "paid" | "failed" | "refunded";

export type PaymentState = {
  invoiceRef: string;
  /** From the subscription's metadata frozen on the invoice; may be missing on old invoices. */
  workspace: string | null;
  subscriptionRef: string | null;
  amount: number;
  vatAmount: number;
  currency: string;
  paidAt: string;
  invoiceUrl: string | null;
  attempt: number;
};

export function invoiceSubscriptionRef(invoice: Stripe.Invoice): string | null {
  return idOf(invoice.parent?.subscription_details?.subscription ?? null);
}

/**
 * One invoice as a payment row. Paid: what was paid, at the time it was
 * paid; failed: what is due, at the attempt; the VAT inside the amount from
 * the invoice's taxes (none while Stripe Tax is off). Only an https link to
 * the hosted invoice is kept.
 */
export function paymentFromInvoice(
  invoice: Stripe.Invoice,
  status: PaymentStatus,
  eventAt: Date,
): PaymentState {
  const minor = status === "failed" ? invoice.amount_due : invoice.amount_paid;
  const vat = (invoice.total_taxes ?? []).reduce((sum, tax) => sum + (tax.amount ?? 0), 0);
  const amount = fromMinorUnits(Math.max(0, minor ?? 0));
  const paidAt =
    status === "failed" ? eventAt.toISOString() : (toIso(invoice.status_transitions?.paid_at) ?? eventAt.toISOString());
  const url = invoice.hosted_invoice_url ?? null;
  return {
    invoiceRef: invoice.id ?? "",
    workspace: workspaceOf(invoice.parent?.subscription_details?.metadata),
    subscriptionRef: invoiceSubscriptionRef(invoice),
    amount,
    vatAmount: Math.min(amount, fromMinorUnits(Math.max(0, vat))),
    currency: (invoice.currency ?? "").toUpperCase(),
    paidAt,
    invoiceUrl: url && /^https:\/\//.test(url) && url.length <= 2000 ? url : null,
    attempt: Math.max(0, invoice.attempt_count ?? 0),
  };
}

/** A charge refunded in full; a partial refund leaves the payment paid. */
export const isFullRefund = (charge: Stripe.Charge) =>
  charge.refunded === true || (charge.amount > 0 && charge.amount_refunded >= charge.amount);

export const paymentIntentOf = (charge: Stripe.Charge) => idOf(charge.payment_intent);
