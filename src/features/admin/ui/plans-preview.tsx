"use client";

import { useState } from "react";
import { NextIntlClientProvider, useTimeZone, useTranslations, type AbstractIntlMessages } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import {
  CATALOG_LOCALES,
  priceCurrencyFor,
  type CatalogLocale,
  type PlanCatalog,
} from "@/config/pricing";
import { PricingCards } from "@/features/marketing/pricing-cards";
import { webFormatSettings } from "@/features/marketing/web-pricing";
import { cn } from "@/lib/utils";

/** The texts the cards need in each language: `plans` and the website's button. */
export type PreviewMessages = Record<CatalogLocale, AbstractIntlMessages>;

/**
 * "What a visitor will see": the cards exactly as the website renders them,
 * in Czech (CZK) or English (EUR), from whatever the editor holds now.
 */
export function PlansPreview({
  catalog,
  messages,
}: {
  /** Null while the draft has errors: nothing half-valid is drawn. */
  catalog: PlanCatalog | null;
  messages: PreviewMessages;
}) {
  const t = useTranslations("admin.plans.preview");
  const timeZone = useTimeZone();
  const [locale, setLocale] = useState<CatalogLocale>("cs");

  return (
    <div className="flex flex-col gap-4" data-testid="plans-preview">
      <div
        role="radiogroup"
        aria-label={t("language")}
        className="flex items-center gap-1 self-start rounded-xl border border-line bg-canvas p-1"
      >
        {CATALOG_LOCALES.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={locale === option}
            onClick={() => setLocale(option)}
            className={cn(
              "flex min-h-11 cursor-pointer items-center rounded-lg px-4 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 mouse:min-h-9",
              locale === option ? "bg-violet/20 text-ink" : "text-ink-muted hover:text-ink",
            )}
          >
            {t(option)}
          </button>
        ))}
      </div>
      {catalog ? (
        <div className="rounded-2xl border border-line bg-canvas p-4 md:p-6" lang={locale}>
          <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone={timeZone}>
            <PreviewCards catalog={catalog} locale={locale} />
          </NextIntlClientProvider>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">{t("invalid")}</p>
      )}
    </div>
  );
}

function PreviewCards({ catalog, locale }: { catalog: PlanCatalog; locale: CatalogLocale }) {
  const t = useTranslations("marketing.cta");
  return (
    <PricingCards
      flat
      plans={catalog}
      currency={priceCurrencyFor(locale)}
      formatSettings={webFormatSettings(locale)}
      // The website's button, inert here.
      action={() => (
        <span aria-hidden className={cn(buttonVariants(), "pointer-events-none w-full")}>
          {t("tryFree")}
        </span>
      )}
    />
  );
}
