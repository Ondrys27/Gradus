"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getLocale, getTranslations } from "next-intl/server";
import type Stripe from "stripe";
import { z } from "zod";
import type { CatalogPlan, PriceCurrency } from "@/config/pricing";
import { chargeCurrency } from "@/features/plan/localized";
import { DEFAULT_FORMAT_SETTINGS } from "@/lib/format";
import { PROMO_BENEFITS, type PromoBenefitKind } from "@/features/promo/codes";
import { planChoiceSchema, type PlanChoiceInput } from "@/features/subscription/schemas";
import {
  runSubscription,
  SubscriptionError,
  type SubscriptionResult,
} from "@/features/subscription/server-context";
import { changeBlock, paymentRoute } from "@/features/subscription/state";
import { track } from "@/lib/analytics/track";
import { LOCALIZED_PAGES, PLAN_PATH } from "@/lib/routes";
import { siteOrigin } from "@/lib/site-origin";
import type { Database } from "@/types/database";
import { gatewayFor, loadStoredSubscription, viaStripe } from "./account";
import { ensureCatalogPrices, loadPublishedVersion } from "./catalog-sync";
import { vatMode } from "./client";
import { promoCoupon, type CouponSpec } from "./coupon";
import { ensureCustomer, storedCustomer } from "./customer";
import { subscriptionState, workspaceOf } from "./mapping";
import type { StripeMode } from "./modes";
import { ensurePortalConfiguration } from "./portal";
import { addOnLookupKey, planPeriodPrice, priceLookupKey } from "./prices";
import { extraWorkerQuantity } from "./seats";
import { applySubscriptionState, hasPaidStripeInvoice } from "./store";
import { checkoutStart } from "./timing";
import { CHECKOUT_SOURCES, PORTAL_SOURCES, type CheckoutSource, type PortalSource } from "./sources";

/**
 * Paying for a plan (step 23.1): a Stripe Checkout of a subscription for the
 * workspace's owner. Offered while nothing runs in Stripe: during the free
 * trial (the paid period starts at its end), after the trial or a plan has
 * ended (it starts now). Beta and plans outside the catalog never get one.
 * The prices are the published catalog version's, the extra workers a second
 * item, the account's promo code a coupon; the customer cannot enter other
 * codes. Nothing is written here: the webhook records the outcome.
 */

type Admin = SupabaseClient<Database>;

const checkoutSchema = planChoiceSchema.extend({ from: z.enum(CHECKOUT_SOURCES) });
export type CheckoutInput = PlanChoiceInput & { from: CheckoutSource };

type PromoStatus = {
  redemption: { code: string; benefit: string; benefit_value: number } | null;
  paid: boolean;
};

/**
 * The account's code, while it has not paid yet (the benefit is for the first
 * payment only). An invoice the coupon took to zero (a free month, 100 % off)
 * is a payment of the code too: once a Stripe invoice of the account was
 * paid, at any amount, a later Checkout gets no coupon, otherwise cancelling
 * and paying again would repeat the free months for ever.
 */
async function promoOf(admin: Admin, userId: string) {
  const { data, error } = await admin.rpc("promo_account_status", { _user_id: userId });
  if (error) throw error;
  const status = data as unknown as PromoStatus | null;
  const redemption = status?.redemption;
  if (!redemption || status?.paid) return null;
  if (await hasPaidStripeInvoice(admin, userId)) return null;
  if (!(PROMO_BENEFITS as readonly string[]).includes(redemption.benefit)) return null;
  return {
    code: redemption.code,
    benefit: { benefit: redemption.benefit as PromoBenefitKind, value: Number(redemption.benefit_value) },
  };
}

const isMissing = (error: unknown) =>
  (error as { code?: string } | null)?.code === "resource_missing";

/** The coupon, made once: its id carries everything that decides it. */
async function ensureCoupon(stripe: Stripe, coupon: CouponSpec) {
  try {
    await stripe.coupons.retrieve(coupon.id);
    return;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  await stripe.coupons.create(
    {
      id: coupon.id,
      name: coupon.name,
      duration: coupon.duration,
      ...(coupon.durationInMonths ? { duration_in_months: coupon.durationInMonths } : {}),
      ...(coupon.percentOff !== undefined ? { percent_off: coupon.percentOff } : {}),
      ...(coupon.amountOff !== undefined ? { amount_off: coupon.amountOff, currency: coupon.currency } : {}),
      // The plan's price only, never the extra workers.
      applies_to: { products: coupon.products },
      metadata: { app: "gradus" },
    },
    { idempotencyKey: `coupon:${coupon.id}` },
  );
}

/** Stripe statuses of a subscription that still bills (or will): a second one would charge twice. */
const RUNNING_STATUSES: readonly Stripe.Subscription.Status[] = ["active", "trialing", "past_due", "unpaid", "paused"];

/**
 * One subscription per workspace. A Checkout paid in another tab, whose
 * webhook has not arrived yet, already runs in Stripe: it is written now
 * (as the webhook would) and no second Checkout starts. Any other Checkout
 * still open for the customer is expired, so two of them can never both be
 * paid.
 */
async function refuseSecondSubscription(
  stripe: Stripe,
  admin: Admin,
  mode: StripeMode,
  customer: string,
  workspace: string,
) {
  const subscriptions = await stripe.subscriptions.list({ customer, status: "all", limit: 20 });
  const running = subscriptions.data.find(
    (sub) => RUNNING_STATUSES.includes(sub.status) && workspaceOf(sub.metadata) === workspace,
  );
  if (running) {
    const scheduleId = typeof running.schedule === "string" ? running.schedule : (running.schedule?.id ?? null);
    const schedule = scheduleId
      ? await stripe.subscriptionSchedules.retrieve(scheduleId, { expand: ["phases.items.price"] })
      : null;
    const mapped = subscriptionState(running, schedule);
    if (mapped.ok && mapped.state.workspace === workspace) {
      await applySubscriptionState(admin, mapped.state, mode, new Date(running.created * 1000));
    }
    throw new SubscriptionError("notAllowed");
  }
  const open = await stripe.checkout.sessions.list({ customer, status: "open", limit: 20 });
  for (const session of open.data) await stripe.checkout.sessions.expire(session.id);
}

/**
 * The currency Checkout charges: the user's own when the plan has a manual
 * price in it, else EUR (a price derived at the day's rate is only shown).
 */
async function priceCurrency(admin: Admin, userId: string, plan: CatalogPlan): Promise<PriceCurrency> {
  const { data } = await admin.from("user_settings").select("currency").eq("user_id", userId).maybeSingle();
  return chargeCurrency(plan, data?.currency ?? DEFAULT_FORMAT_SETTINGS.currency);
}

export async function startCheckout(input: CheckoutInput): Promise<SubscriptionResult<{ url: string }>> {
  return runSubscription("startCheckout", async (ctx) => {
    const parsed = checkoutSchema.safeParse(input);
    if (!parsed.success) throw new SubscriptionError("invalid");
    const { planKey, billing, from } = parsed.data;

    const sub = await loadStoredSubscription(ctx.admin, ctx.userId);
    if (!sub) throw new SubscriptionError("notAllowed");
    const block = changeBlock(sub);
    if (block === "cancelPending") throw new SubscriptionError("cancelPending");
    if (block) throw new SubscriptionError("notAllowed");
    // A subscription in Stripe changes through Stripe; one the administration set, by hand.
    if (paymentRoute(sub) !== "checkout") throw new SubscriptionError("notAllowed");

    const gateway = await gatewayFor(ctx);
    const { stripe, mode } = gateway;
    const version = await loadPublishedVersion(ctx.admin);
    const plan = version.catalog.find((candidate) => candidate.key === planKey);
    if (!plan) throw new SubscriptionError("notAllowed");
    const currency = await priceCurrency(ctx.admin, ctx.userId, plan);
    const locale = (await getLocale()) === "en" ? "en" : "cs";
    const t = await getTranslations({ locale, namespace: "billing.checkout" });
    const site = await siteOrigin();

    const promo = await promoOf(ctx.admin, ctx.userId);
    const coupon = promo
      ? promoCoupon({
          code: promo.code,
          benefit: promo.benefit,
          billing,
          currency,
          regular: planPeriodPrice(plan, currency, billing),
          version: version.number,
        })
      : null;

    const url = await viaStripe("checkout", async () => {
      const prices = await ensureCatalogPrices(stripe, mode, version);
      const key = { plan: planKey, currency, billing, version: version.number };
      const planPrice = prices.get(priceLookupKey({ ...key, kind: "plan" }));
      if (!planPrice) throw new SubscriptionError("unknown");
      const workerPrice = prices.get(priceLookupKey({ ...key, kind: "worker" }));
      const workers = workerPrice ? await extraWorkerQuantity(ctx.admin, ctx.userId, plan) : 0;
      // The add-ons switched on during the trial are paid with the plan, at its period.
      const addOnPrices = sub.addOns.map((addOn) => {
        const price = prices.get(addOnLookupKey({ addOn, currency, billing, version: version.number }));
        if (!price) throw new SubscriptionError("unknown");
        return price;
      });
      const customer = await ensureCustomer(stripe, ctx.admin, {
        workspace: ctx.userId,
        mode,
        email: ctx.email,
        locale,
      });
      await refuseSecondSubscription(stripe, ctx.admin, mode, customer, ctx.userId);
      if (coupon) await ensureCoupon(stripe, coupon);

      const start = checkoutStart(sub);
      const metadata = {
        workspace: ctx.userId,
        plan: planKey,
        billing,
        catalog_version: version.id,
        version: String(version.number),
      };
      const taxed = vatMode() === "stripe_tax";
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer,
        client_reference_id: ctx.userId,
        line_items: [
          { price: planPrice, quantity: 1 },
          ...(workerPrice && workers > 0 ? [{ price: workerPrice, quantity: workers }] : []),
          ...addOnPrices.map((price) => ({ price, quantity: 1 })),
        ],
        metadata,
        subscription_data: {
          metadata,
          ...(start.kind === "trial" ? { trial_end: start.trialEnd } : {}),
          // The trial's last two days: anchored at its end, the days up to it free.
          ...(start.kind === "anchor"
            ? { billing_cycle_anchor: start.anchor, proration_behavior: "none" as const }
            : {}),
        },
        // Only Gradus's own coupon; the customer cannot enter codes in Stripe.
        ...(coupon ? { discounts: [{ coupon: coupon.id }] } : { allow_promotion_codes: false }),
        locale,
        success_url: `${site}${PLAN_PATH}?checkout=success`,
        cancel_url: `${site}${PLAN_PATH}?checkout=cancelled`,
        payment_method_collection: "always",
        billing_address_collection: "auto",
        consent_collection: { terms_of_service: "required" },
        custom_text: {
          terms_of_service_acceptance: {
            message: t("terms", { url: `${site}${LOCALIZED_PAGES.terms[locale]}` }),
          },
          submit: { message: t(start.kind === "now" ? "startsNow" : "startsAfterTrial") },
        },
        ...(taxed
          ? {
              automatic_tax: { enabled: true },
              customer_update: { address: "auto" as const, name: "auto" as const },
            }
          : {}),
      });
      if (!session.url) throw new SubscriptionError("unknown");
      return session.url;
    });

    await track(
      "checkout_started",
      { plan: planKey, billing, currency, with_promo: promo !== null, from },
      { userId: ctx.userId, ownerId: ctx.userId, admin: ctx.admin },
    );
    return { url };
  });
}

// ---------------------------------------------------------------------------
// Stripe's Customer Portal (step 23.2)
// ---------------------------------------------------------------------------

/** Gradus's portal configuration per mode, made or checked once per process. */
const portalConfigurations = new Map<string, string>();

const portalSchema = z.object({ from: z.enum(PORTAL_SOURCES) });

/**
 * "Manage payment method and receipts": a Customer Portal session for the
 * workspace's Stripe customer, back to Settings → Subscription. Only the
 * owner, only a subscription that runs (or ran) through Stripe in this
 * deployment's mode. The portal changes the card, the billing address and
 * shows the receipts; plans and cancelling stay Gradus's. Works in the
 * read-only mode too (a card that failed is how the account gets out of it).
 */
export async function openBillingPortal(input: { from: PortalSource }): Promise<SubscriptionResult<{ url: string }>> {
  return runSubscription("openBillingPortal", async (ctx) => {
    const parsed = portalSchema.safeParse(input);
    if (!parsed.success) throw new SubscriptionError("invalid");
    const sub = await loadStoredSubscription(ctx.admin, ctx.userId);
    if (!sub || sub.gateway !== "stripe") throw new SubscriptionError("notAllowed");
    const { stripe, mode } = await gatewayFor(ctx);
    if (sub.stripeMode !== mode) throw new SubscriptionError("paymentsUnavailable");
    const customer = await storedCustomer(ctx.admin, ctx.userId, mode);
    if (!customer) throw new SubscriptionError("notAllowed");
    const locale = (await getLocale()) === "en" ? "en" : "cs";
    const site = await siteOrigin();

    const url = await viaStripe("portal", async () => {
      let configuration = portalConfigurations.get(mode);
      if (!configuration) {
        configuration = (await ensurePortalConfiguration(stripe, process.env.NEXT_PUBLIC_SITE_URL ?? site)).id;
        portalConfigurations.set(mode, configuration);
      }
      const session = await stripe.billingPortal.sessions.create({
        customer,
        configuration,
        locale,
        return_url: `${site}${PLAN_PATH}`,
      });
      return session.url;
    });

    await track(
      "billing_portal_opened",
      { from: parsed.data.from, past_due: sub.status === "past_due" },
      { userId: ctx.userId, ownerId: ctx.userId, admin: ctx.admin },
    );
    return { url };
  });
}
