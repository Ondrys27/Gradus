"use client";

import { useLocale, useTranslations } from "next-intl";
import { priceCurrencyFor } from "@/config/pricing";
import { DEFAULT_FORMAT_SETTINGS, NUMBER_FORMATS } from "@/lib/format";
import { PricingCards } from "./pricing-cards";
import { SignupCta } from "./signup-cta";

/**
 * The plans on the website: CZK in Czech, EUR in English, each with the main
 * button; under them the free trial, the link to the FAQ and, in small, VAT.
 */
export function WebPricing({
  signupEnabled,
  faqHref,
}: {
  signupEnabled: boolean;
  faqHref: string;
}) {
  const locale = useLocale();
  const t = useTranslations("plans");
  const tHome = useTranslations("marketing.home.pricing");
  // A visitor has no settings yet: the page's language picks number style and currency.
  const formatSettings =
    locale === "cs"
      ? DEFAULT_FORMAT_SETTINGS
      : { ...DEFAULT_FORMAT_SETTINGS, numberLocale: NUMBER_FORMATS.en };
  return (
    <PricingCards
      currency={priceCurrencyFor(locale)}
      formatSettings={formatSettings}
      action={(plan) => (
        <SignupCta
          signupEnabled={signupEnabled}
          source={`pricing-${plan.key}`}
          className="w-full"
        />
      )}
      footnote={
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-ink-soft">
            {t("trialNote")}{" "}
            <a
              href={faqHref}
              className="font-medium text-violet underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {tHome("faqLink")}
            </a>
          </p>
          <p className="text-xs text-ink-muted">{t("vatNote")}</p>
        </div>
      }
    />
  );
}
