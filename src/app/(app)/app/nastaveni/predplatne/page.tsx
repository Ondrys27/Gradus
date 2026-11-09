import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { stripeSetup } from "@/features/billing/stripe/client";
import { getExchangeRates } from "@/features/currency/server/rates";
import { getPublishedAddOns, getPublishedPlans } from "@/features/plan/catalog-server";
import { SubscriptionPage, type CheckoutReturn } from "@/features/subscription/subscription-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("subscription");
  return { title: t("title") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Settings → Subscription, with the plans and add-ons of the published
 * catalog (never a draft), the exchange rates for the user's currency, whether Stripe runs in this deployment, and how a Checkout ended
 * (`?checkout=success|cancelled`, Stripe's return).
 */
export default async function PredplatnePage({ searchParams }: Props) {
  const params = await searchParams;
  const checkout: CheckoutReturn =
    params.checkout === "success" ? "success" : params.checkout === "cancelled" ? "cancelled" : null;
  const [plans, addOns, rates] = await Promise.all([getPublishedPlans(), getPublishedAddOns(), getExchangeRates()]);
  return (
    <SubscriptionPage
      plans={plans}
      addOns={addOns}
      rates={rates}
      payments={stripeSetup().ok}
      checkout={checkout}
    />
  );
}
