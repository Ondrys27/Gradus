import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getPublishedPlans } from "@/features/plan/catalog-server";
import { SubscriptionPage } from "@/features/subscription/subscription-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("subscription");
  return { title: t("title") };
}

/** Settings → Subscription, with the plans of the published catalog (never a draft). */
export default async function PredplatnePage() {
  return <SubscriptionPage plans={await getPublishedPlans()} />;
}
