import { getTranslations } from "next-intl/server";
import { getPublishedPlans } from "@/features/plan/catalog-server";
import { homeAnchorId, type SiteLocale } from "@/lib/routes";
import { WebPricing } from "../web-pricing";

/**
 * 6. The three published plans; on the home page under #cenik, and as the /cenik page.
 * The heading sits on the left with one plain sentence, the cards under it.
 */
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
  const [t, plans] = await Promise.all([
    getTranslations({ locale, namespace: "marketing.pricing" }),
    getPublishedPlans(),
  ]);
  const Heading = headingLevel === 1 ? "h1" : "h2";

  return (
    <section
      id={homeAnchorId(locale, "pricing")}
      aria-labelledby="pricing-title"
      className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 pt-28 md:px-8 md:pt-44"
    >
      <header className="grid gap-4 md:grid-cols-12 md:items-end">
        <Heading
          id="pricing-title"
          className="font-display text-5xl leading-[0.95] font-semibold tracking-[-0.035em] text-ink md:col-span-4 md:text-7xl"
        >
          {t("title")}
        </Heading>
        <p className="max-w-[34rem] text-lg leading-relaxed text-ink-soft md:col-span-7 md:col-start-6">
          {t("subtitle")}
        </p>
      </header>
      <div className="mt-12 md:mt-16">
        <WebPricing
          plans={plans}
          signupEnabled={signupEnabled}
          faqHref={`#${homeAnchorId(locale, "faq")}`}
        />
      </div>
    </section>
  );
}
