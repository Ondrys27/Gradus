import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { APP_NAME } from "@/lib/constants";
import { homeAnchorId, type SiteLocale } from "@/lib/routes";
import { isPublicSignupEnabled } from "@/lib/signup";
import { Closing } from "./home/closing";
import { GameShowcase } from "./home/game-demo";
import { Hero } from "./home/hero";
import { PricingSection } from "./home/pricing-section";
import { Stories } from "./home/stories";
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

/**
 * The home page in six blocks: the promise with the app under it, three
 * stories (pipeline, cold calling, Jarvis), the game, the plans, and the
 * questions together with the last call.
 */
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
      <Stories locale={locale} />
      <GameShowcase id={homeAnchorId(locale, "game")} />
      <PricingSection locale={locale} signupEnabled={signupEnabled} />
      <Closing locale={locale} signupEnabled={signupEnabled} />
    </>
  );
}
