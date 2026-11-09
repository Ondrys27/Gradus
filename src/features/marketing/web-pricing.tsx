"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CurrencyPicker } from "@/components/ui/currency-picker";
import type { CatalogPlan } from "@/config/pricing";
import { RateNote } from "@/features/currency/rate-note";
import {
  CURRENCY_PARAMS,
  GEO_CURRENCY_COOKIE,
  PICKED_CURRENCY_KEY,
  pageCurrency,
  readCookie,
  USER_CURRENCY_COOKIE,
  visitorCurrency,
} from "@/features/currency/visitor-currency";
import { localizePlans } from "@/features/plan/localized";
import { BASE_CURRENCY } from "@/lib/currency";
import type { RateTable } from "@/lib/exchange-rates";
import { DEFAULT_FORMAT_SETTINGS, NUMBER_FORMATS, type FormatSettings } from "@/lib/format";
import { PricingCards } from "./pricing-cards";
import { SignupCta } from "./signup-cta";

/** A visitor has no settings yet: the page's language picks the number style. */
export function webFormatSettings(locale: string): FormatSettings {
  return locale === "cs"
    ? DEFAULT_FORMAT_SETTINGS
    : { ...DEFAULT_FORMAT_SETTINGS, numberLocale: NUMBER_FORMATS.en };
}

function readPicked(): string | null {
  try {
    return window.localStorage.getItem(PICKED_CURRENCY_KEY);
  } catch {
    return null;
  }
}

/**
 * The published plans on the website, each with the main button; under them
 * the free trial, the link to the FAQ and, in small, VAT. The prices are in
 * the visitor's currency (visitorCurrency: their pick, their account's, their
 * country's, else the page's) with a switcher; a currency without a manual
 * price is converted at the day's rate and says so.
 */
export function WebPricing({
  plans,
  rates,
  signupEnabled,
  faqHref,
}: {
  plans: readonly CatalogPlan[];
  rates: RateTable;
  signupEnabled: boolean;
  faqHref: string;
}) {
  const locale = useLocale();
  const t = useTranslations("plans");
  const tHome = useTranslations("marketing.home.pricing");
  const tCurrency = useTranslations("currency");
  // The server renders the page's currency; the visitor's own is known only here.
  const [currency, setCurrency] = useState(() => pageCurrency(locale));
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const param = CURRENCY_PARAMS.map((name) => params.get(name)).find(Boolean) ?? null;
    setCurrency(
      visitorCurrency(locale, {
        param,
        picked: readPicked(),
        user: readCookie(document.cookie, USER_CURRENCY_COOKIE),
        geo: readCookie(document.cookie, GEO_CURRENCY_COOKIE),
      }),
    );
  }, [locale]);
  const prices = useMemo(() => localizePlans(plans, currency, rates), [plans, currency, rates]);
  const format = webFormatSettings(locale);

  function pick(code: string) {
    setCurrency(code);
    try {
      window.localStorage.setItem(PICKED_CURRENCY_KEY, code);
    } catch {
      // Private mode: the pick lasts until the page is left.
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="web-pricing" data-currency={prices.currency}>
      <div className="flex items-center justify-end gap-2 text-sm text-ink-soft">
        <label htmlFor="web-currency">{tCurrency("switcher")}</label>
        <CurrencyPicker id="web-currency" value={currency} onChange={pick} className="w-auto min-w-40" />
      </div>
      <PricingCards
        flat
        plans={prices.plans}
        currency={prices.currency}
        formatSettings={format}
        action={(plan, billing) => (
          <SignupCta
            signupEnabled={signupEnabled}
            source={`pricing-${plan.key}`}
            plan={{ planKey: plan.key, billing }}
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
            {prices.derived && prices.rateAt && (
              <RateNote at={prices.rateAt} charged={BASE_CURRENCY} format={format} />
            )}
            <p className="text-xs text-ink-muted">{t("vatNote")}</p>
          </div>
        }
      />
    </div>
  );
}
