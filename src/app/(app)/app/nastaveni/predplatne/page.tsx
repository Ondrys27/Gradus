import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { stripeSetup } from "@/features/billing/stripe/client";
import { getPublishedPlans } from "@/features/plan/catalog-server";
import { SubscriptionPage, type CheckoutReturn } from "@/features/subscription/subscription-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("subscription");
  return { title: t("title") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Settings → Subscription, with the plans of the published catalog (never a
 * draft), whether Stripe runs in this deployment, and how a Checkout ended
 * (`?checkout=success|cancelled`, Stripe's return).
 */
export default async function PredplatnePage({ searchParams }: Props) {
  const params = await searchParams;
  const checkout: CheckoutReturn =
    params.checkout === "success" ? "success" : params.checkout === "cancelled" ? "cancelled" : null;
  return (
    <SubscriptionPage plans={await getPublishedPlans()} payments={stripeSetup().ok} checkout={checkout} />
  );
}
