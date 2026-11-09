"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getLocale, getTranslations } from "next-intl/server";
import type Stripe from "stripe";
import { z } from "zod";
import { priceCurrencyFor, type PriceCurrency } from "@/config/pricing";
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
import { ensureCustomer } from "./customer";
import { planPeriodPrice, priceLookupKey } from "./prices";
import { extraWorkerQuantity } from "./seats";
import { checkoutStart } from "./timing";
import { CHECKOUT_SOURCES, type CheckoutSource } from "./sources";

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

/** The account's code, while it has not paid yet (the benefit is for the first payment only). */
async function promoOf(admin: Admin, userId: string) {
  const { data, error } = await admin.rpc("promo_account_status", { _user_id: userId });
  if (error) throw error;
  const status = data as unknown as PromoStatus | null;
  const redemption = status?.redemption;
  if (!redemption || status?.paid) return null;
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
      metadata: { app: "gradus" },
    },
    { idempotencyKey: `coupon:${coupon.id}` },
  );
}

async function priceCurrency(admin: Admin, userId: string): Promise<PriceCurrency> {
  const { data } = await admin.from("user_settings").select("currency").eq("user_id", userId).maybeSingle();
  return priceCurrencyFor(data?.currency ?? "CZK");
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
    const currency = await priceCurrency(ctx.admin, ctx.userId);
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
      const customer = await ensureCustomer(stripe, ctx.admin, {
        workspace: ctx.userId,
        mode,
        email: ctx.email,
        locale,
      });
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
