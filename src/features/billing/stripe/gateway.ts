import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import type { Billing, CatalogPlan, PaidPlanKey, PriceCurrency } from "@/config/pricing";
import type { ChangeTiming } from "@/features/subscription/state";
import type { Database } from "@/types/database";
import { ensureCatalogPrices, loadPublishedVersion, type PublishedVersion } from "./catalog-sync";
import { subscriptionState, type SubscriptionState } from "./mapping";
import type { StripeMode } from "./modes";
import { priceLookupKey } from "./prices";
import { extraWorkerQuantity } from "./seats";

/**
 * Changes of a subscription that runs in Stripe (step 23.1), in Stripe's
 * terms of Gradus's rules (subscription_request_change() and state.ts):
 * - up (a higher plan, or a year instead of a month) now, the difference
 *   prorated and invoiced at once;
 * - down at the end of the period, through a Subscription Schedule whose
 *   next phase is the lower plan (the webhook keeps scheduled_plan_* with it);
 * - the current plan again drops the schedule;
 * - cancelling sets cancel_at_period_end (the reason and the note stay in
 *   Gradus), resuming takes it back.
 * Status and period are never written here: the webhook does that.
 */

type Admin = SupabaseClient<Database>;

export type GatewayContext = { stripe: Stripe; mode: StripeMode; admin: Admin; workspace: string };

export class GatewayStateError extends Error {
  constructor(readonly reason: string) {
    super(`stripe subscription: ${reason}`);
  }
}

const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : (value?.id ?? null);
const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const interval = (billing: Billing): "month" | "year" => (billing === "monthly" ? "month" : "year");

async function load(ctx: GatewayContext, ref: string) {
  const sub = await ctx.stripe.subscriptions.retrieve(ref);
  const mapped = subscriptionState(sub);
  if (!mapped.ok) throw new GatewayStateError(mapped.problem);
  if (mapped.state.workspace !== ctx.workspace) throw new GatewayStateError("workspace_mismatch");
  return { sub, state: mapped.state };
}

async function releaseSchedule(ctx: GatewayContext, sub: Stripe.Subscription) {
  const id = idOf(sub.schedule);
  if (!id) return;
  const schedule = await ctx.stripe.subscriptionSchedules.retrieve(id);
  if (schedule.status === "active" || schedule.status === "not_started") {
    await ctx.stripe.subscriptionSchedules.release(id);
  }
}

type Target = {
  plan: CatalogPlan;
  planKey: PaidPlanKey;
  billing: Billing;
  planPrice: string;
  workerPrice: string | null;
  workers: number;
  version: PublishedVersion;
};

async function target(
  ctx: GatewayContext,
  choice: { planKey: PaidPlanKey; billing: Billing },
  currency: PriceCurrency,
): Promise<Target> {
  const version = await loadPublishedVersion(ctx.admin);
  const plan = version.catalog.find((candidate) => candidate.key === choice.planKey);
  if (!plan) throw new GatewayStateError("plan_missing");
  const prices = await ensureCatalogPrices(ctx.stripe, ctx.mode, version);
  const key = { plan: choice.planKey, currency, billing: choice.billing, version: version.number };
  const planPrice = prices.get(priceLookupKey({ ...key, kind: "plan" }));
  if (!planPrice) throw new GatewayStateError("price_missing");
  const workerPrice = prices.get(priceLookupKey({ ...key, kind: "worker" })) ?? null;
  const workers = workerPrice ? await extraWorkerQuantity(ctx.admin, ctx.workspace, plan) : 0;
  return { plan, ...choice, planPrice, workerPrice, workers, version };
}

const asCurrency = (value: string | null): PriceCurrency => (value === "EUR" ? "EUR" : "CZK");

const metadataFor = (ctx: GatewayContext, to: Target) => ({
  workspace: ctx.workspace,
  plan: to.planKey,
  billing: to.billing,
  catalog_version: to.version.id,
});

/** The items of the target plan, the extra workers as a second item with their count. */
function targetItems(to: Target): { price: string; quantity: number }[] {
  return [
    { price: to.planPrice, quantity: 1 },
    ...(to.workerPrice && to.workers > 0 ? [{ price: to.workerPrice, quantity: to.workers }] : []),
  ];
}

export async function changeStripePlan(
  ctx: GatewayContext,
  ref: string,
  choice: { planKey: PaidPlanKey; billing: Billing },
  timing: ChangeTiming,
): Promise<void> {
  const { sub, state } = await load(ctx, ref);
  if (timing === "none") {
    await releaseSchedule(ctx, sub);
    return;
  }
  // A subscription keeps its currency in Stripe; the new prices are in it too.
  const to = await target(ctx, choice, asCurrency(state.currency));
  if (timing === "immediate") {
    await releaseSchedule(ctx, sub);
    const items: Stripe.SubscriptionUpdateParams.Item[] = [{ id: state.planItemId, price: to.planPrice }];
    if (state.workerItem) {
      items.push(
        to.workerPrice && to.workers > 0
          ? { id: state.workerItem.id, price: to.workerPrice, quantity: to.workers }
          : { id: state.workerItem.id, deleted: true },
      );
    } else if (to.workerPrice && to.workers > 0) {
      items.push({ price: to.workerPrice, quantity: to.workers });
    }
    await ctx.stripe.subscriptions.update(ref, {
      items,
      // Nothing is charged during a trial; otherwise the difference is invoiced now.
      proration_behavior: sub.status === "trialing" ? "none" : "always_invoice",
      metadata: metadataFor(ctx, to),
    });
    return;
  }
  await scheduleDowngrade(ctx, sub, state, to);
}

async function scheduleDowngrade(
  ctx: GatewayContext,
  sub: Stripe.Subscription,
  state: SubscriptionState,
  to: Target,
) {
  if (!state.periodEnd) throw new GatewayStateError("no_period_end");
  const existing = idOf(sub.schedule);
  const schedule = existing
    ? await ctx.stripe.subscriptionSchedules.retrieve(existing)
    : await ctx.stripe.subscriptionSchedules.create({ from_subscription: sub.id });
  const now = Math.floor(Date.now() / 1000);
  const current =
    schedule.phases.find((phase) => phase.start_date <= now && phase.end_date > now) ?? schedule.phases[0];
  if (!current) throw new GatewayStateError("no_phase");
  const end = unix(state.periodEnd);
  await ctx.stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: "release",
    phases: [
      {
        items: current.items.map((item) => ({
          price: idOf(item.price) as string,
          ...(typeof item.quantity === "number" ? { quantity: item.quantity } : {}),
        })),
        start_date: current.start_date,
        end_date: end,
        ...(current.trial_end ? { trial_end: current.trial_end } : {}),
        proration_behavior: "none",
        ...(current.metadata ? { metadata: current.metadata } : {}),
      },
      {
        items: targetItems(to),
        duration: { interval: interval(to.billing) },
        proration_behavior: "none",
        metadata: metadataFor(ctx, to),
      },
    ],
  });
}

export async function cancelStripeSubscription(ctx: GatewayContext, ref: string): Promise<void> {
  const { sub } = await load(ctx, ref);
  // A scheduled downgrade is dropped: a cancelled plan changes no more.
  await releaseSchedule(ctx, sub);
  await ctx.stripe.subscriptions.update(ref, { cancel_at_period_end: true });
}

export async function resumeStripeSubscription(ctx: GatewayContext, ref: string): Promise<void> {
  await load(ctx, ref);
  await ctx.stripe.subscriptions.update(ref, { cancel_at_period_end: false });
}

/**
 * The extra workers' item kept at the number of extra workers (22.5): a
 * change counts from the next period (no prorations). Left alone while a
 * schedule holds the next phase (it was counted when scheduled). Returns
 * whether anything changed.
 */
export async function syncWorkerSeats(
  ctx: GatewayContext,
  sub: Stripe.Subscription,
  state: SubscriptionState,
  version: PublishedVersion,
  prices: Map<string, string>,
): Promise<boolean> {
  if (idOf(sub.schedule) || state.status === "cancelled") return false;
  const plan = version.catalog.find((candidate) => candidate.key === state.planKey);
  if (!plan) return false;
  const quantity = await extraWorkerQuantity(ctx.admin, ctx.workspace, plan);
  const have = state.workerItem?.quantity ?? 0;
  if (quantity === have) return false;
  if (state.workerItem) {
    if (quantity > 0) {
      await ctx.stripe.subscriptionItems.update(state.workerItem.id, { quantity, proration_behavior: "none" });
    } else {
      await ctx.stripe.subscriptionItems.del(state.workerItem.id, { proration_behavior: "none" });
    }
    return true;
  }
  const workerPrice = prices.get(
    priceLookupKey({
      kind: "worker",
      plan: state.planKey,
      currency: asCurrency(state.currency),
      billing: state.billing,
      version: version.number,
    }),
  );
  if (!workerPrice) return false;
  await ctx.stripe.subscriptionItems.create({
    subscription: sub.id,
    price: workerPrice,
    quantity,
    proration_behavior: "none",
  });
  return true;
}
