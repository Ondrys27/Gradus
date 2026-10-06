import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WebPricing } from "@/features/marketing/web-pricing";
import { isPublicSignupEnabled } from "@/lib/signup";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing.meta");
  return { title: t("pricingTitle"), description: t("pricingDescription") };
}

export default async function PricingPage() {
  const t = await getTranslations("marketing.pricing");
  return (
    <section className="flex flex-col gap-10 py-16 md:py-24">
      <header className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-ink md:text-5xl">{t("title")}</h1>
        <p className="max-w-xl text-lg text-ink-soft">{t("subtitle")}</p>
      </header>
      <WebPricing signupEnabled={isPublicSignupEnabled()} />
    </section>
  );
}
