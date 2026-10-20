"use client";

import { useLocale, useTranslations } from "next-intl";
import { priceCurrencyFor, type CatalogPlan } from "@/config/pricing";
import { DEFAULT_FORMAT_SETTINGS, NUMBER_FORMATS, type FormatSettings } from "@/lib/format";
import { PricingCards } from "./pricing-cards";
import { SignupCta } from "./signup-cta";

/** A visitor has no settings yet: the page's language picks number style and currency. */
export function webFormatSettings(locale: string): FormatSettings {
  return locale === "cs"
    ? DEFAULT_FORMAT_SETTINGS
    : { ...DEFAULT_FORMAT_SETTINGS, numberLocale: NUMBER_FORMATS.en };
}

/**
 * The published plans on the website: CZK in Czech, EUR in English, each with
 * the main button; under them the free trial, the link to the FAQ and, in
 * small, VAT.
 */
export function WebPricing({
  plans,
  signupEnabled,
  faqHref,
}: {
  plans: readonly CatalogPlan[];
  signupEnabled: boolean;
  faqHref: string;
}) {
  const locale = useLocale();
  const t = useTranslations("plans");
  const tHome = useTranslations("marketing.home.pricing");
  return (
    <PricingCards
      flat
      plans={plans}
      currency={priceCurrencyFor(locale)}
      formatSettings={webFormatSettings(locale)}
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
