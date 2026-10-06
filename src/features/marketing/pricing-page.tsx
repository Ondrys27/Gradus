import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { SiteLocale } from "@/lib/routes";
import { isPublicSignupEnabled } from "@/lib/signup";
import { Faq } from "./home/faq";
import { PricingSection } from "./home/pricing-section";
import { pageMetadata } from "./seo";

export async function pricingMetadata(locale: SiteLocale): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "marketing.meta" });
  return pageMetadata({
    page: "pricing",
    locale,
    title: t("pricingTitle"),
    description: t("pricingDescription"),
  });
}

/** /cenik: the same plans as on the home page, with the questions under them. */
export async function PricingPage({ locale }: { locale: SiteLocale }) {
  setRequestLocale(locale);
  return (
    <>
      <PricingSection locale={locale} signupEnabled={isPublicSignupEnabled()} headingLevel={1} />
      <Faq />
    </>
  );
}
