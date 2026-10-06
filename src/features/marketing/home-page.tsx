import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { APP_NAME } from "@/lib/constants";
import type { SiteLocale } from "@/lib/routes";
import { isPublicSignupEnabled } from "@/lib/signup";
import { Audience } from "./home/audience";
import { Faq } from "./home/faq";
import { Features } from "./home/features";
import { FinalCta } from "./home/final-cta";
import { GameShowcase } from "./home/game-demo";
import { Hero } from "./home/hero";
import { HowItWorks } from "./home/how-it-works";
import { JarvisShowcase } from "./home/jarvis-showcase";
import { Pains } from "./home/pains";
import { PricingSection } from "./home/pricing-section";
import { pageMetadata, serializeJsonLd, softwareApplicationJsonLd } from "./seo";

export async function homeMetadata(locale: SiteLocale): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "marketing.meta" });
  return pageMetadata({
    page: "home",
    locale,
    title: t("homeTitle", { appName: APP_NAME }),
    description: t("homeDescription", { appName: APP_NAME }),
    absoluteTitle: true,
  });
}

/** The home page, one idea per section. */
export async function HomePage({ locale }: { locale: SiteLocale }) {
  setRequestLocale(locale);
  const [tMeta, tPlans] = await Promise.all([
    getTranslations({ locale, namespace: "marketing.meta" }),
    getTranslations({ locale, namespace: "plans.names" }),
  ]);
  const signupEnabled = isPublicSignupEnabled();
  const jsonLd = softwareApplicationJsonLd({
    locale,
    description: tMeta("homeDescription", { appName: APP_NAME }),
    planNames: { solo: tPlans("solo"), pro: tPlans("pro"), team: tPlans("team") },
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <Hero locale={locale} signupEnabled={signupEnabled} />
      <Pains locale={locale} />
      <Features locale={locale} />
      <HowItWorks locale={locale} />
      <JarvisShowcase />
      <GameShowcase />
      <Audience />
      <PricingSection locale={locale} signupEnabled={signupEnabled} />
      <Faq />
      <FinalCta locale={locale} signupEnabled={signupEnabled} />
    </>
  );
}
