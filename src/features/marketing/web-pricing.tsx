"use client";

import { useLocale } from "next-intl";
import { priceCurrencyFor } from "@/config/pricing";
import { DEFAULT_FORMAT_SETTINGS, NUMBER_FORMATS } from "@/lib/format";
import { PricingCards } from "./pricing-cards";
import { SignupCta } from "./signup-cta";

/** The plans on the website: CZK in Czech, EUR in English, each with the main button. */
export function WebPricing({ signupEnabled }: { signupEnabled: boolean }) {
  const locale = useLocale();
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
    />
  );
}
