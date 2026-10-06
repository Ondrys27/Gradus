import { getTranslations } from "next-intl/server";
import { homeAnchorId, type SiteLocale } from "@/lib/routes";
import { WebPricing } from "../web-pricing";
import { Reveal } from "./reveal";
import { Section, SectionHeading } from "./section";

/** 8. The three plans; on the home page under #cenik, and as the /cenik page. */
export async function PricingSection({
  locale,
  signupEnabled,
  headingLevel = 2,
}: {
  locale: SiteLocale;
  signupEnabled: boolean;
  /** The /cenik page has the plans as its main heading. */
  headingLevel?: 1 | 2;
}) {
  const t = await getTranslations({ locale, namespace: "marketing.pricing" });
  const heading =
    headingLevel === 1 ? (
      <Reveal
        as="header"
        className="mx-auto flex max-w-3xl flex-col items-center gap-4 text-center"
      >
        <h1
          id="pricing-title"
          className="text-4xl font-bold tracking-tight text-balance text-ink md:text-6xl"
        >
          {t("title")}
        </h1>
        <p className="text-lg text-pretty text-ink-soft md:text-xl">{t("subtitle")}</p>
      </Reveal>
    ) : (
      <SectionHeading id="pricing-title" title={t("title")} subtitle={t("subtitle")} />
    );

  return (
    <Section id={homeAnchorId(locale, "pricing")} labelledBy="pricing-title">
      {heading}
      <Reveal className="mt-16">
        <WebPricing signupEnabled={signupEnabled} faqHref={`#${homeAnchorId(locale, "faq")}`} />
      </Reveal>
    </Section>
  );
}
