"use client";

import { useMemo, useState } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { NextIntlClientProvider, useTimeZone, useTranslations, type AbstractIntlMessages } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { CurrencyPicker } from "@/components/ui/currency-picker";
import {
  CATALOG_LOCALES,
  type CatalogAddOn,
  type CatalogLocale,
  type CatalogPlan,
  type PlanCatalog,
} from "@/config/pricing";
import { pageCurrency } from "@/features/currency/visitor-currency";
import { PricingCards } from "@/features/marketing/pricing-cards";
import { webFormatSettings } from "@/features/marketing/web-pricing";
import { planText, sortedPlans } from "@/features/plan/catalog";
import {
  addOnPrice,
  exactPrice,
  localizePlans,
  manualDeviation,
  MANUAL_DEVIATION_WARN,
} from "@/features/plan/localized";
import { BASE_CURRENCY } from "@/lib/currency";
import { rateDate, type RateTable } from "@/lib/exchange-rates";
import { formatDate, formatNumber, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ADMIN_FORMAT_SETTINGS } from "../format-metric";

/** The texts the cards need in each language: `plans` and the website's button. */
export type PreviewMessages = Record<CatalogLocale, AbstractIntlMessages>;

/** The derived prices of one currency, for "set by hand" in the editor. */
export type DerivedPrices = {
  plans: Partial<Record<CatalogPlan["key"], { monthly?: number; yearly?: number; per_worker?: number }>>;
  addOns: Partial<Record<CatalogAddOn["key"], number>>;
};

/**
 * "What a visitor will see": the cards exactly as the website renders them,
 * in Czech or English and in any currency, from whatever the editor holds
 * now. Under them the prices of that currency: manual or derived from EUR at
 * the day's rate, the exact conversion, and a warning when a manual price is
 * more than 15 % from the rate. In the editor a derived currency can be set
 * by hand from here (`onSetManual`).
 */
export function PlansPreview({
  catalog,
  addOns = [],
  rates,
  messages,
  onSetManual,
}: {
  /** Null while the draft has errors: nothing half-valid is drawn. */
  catalog: PlanCatalog | null;
  addOns?: readonly CatalogAddOn[];
  rates: RateTable;
  messages: PreviewMessages;
  /** Adds the currency to the manual prices, prefilled with the derived ones. */
  onSetManual?: (currency: string, prices: DerivedPrices) => void;
}) {
  const t = useTranslations("admin.plans.preview");
  const timeZone = useTimeZone();
  const [locale, setLocale] = useState<CatalogLocale>("cs");
  const [currency, setCurrency] = useState(() => pageCurrency("cs"));
  const prices = useMemo(
    () => (catalog ? localizePlans(catalog, currency, rates) : null),
    [catalog, currency, rates],
  );

  return (
    <div className="flex flex-col gap-4" data-testid="plans-preview">
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="radiogroup"
          aria-label={t("language")}
          className="flex items-center gap-1 rounded-xl border border-line bg-canvas p-1"
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
        <label htmlFor="plans-preview-currency" className="text-sm text-ink-soft">
          {t("currency")}
        </label>
        <CurrencyPicker
          id="plans-preview-currency"
          value={currency}
          onChange={setCurrency}
          className="w-auto min-w-48"
        />
      </div>
      {catalog && prices ? (
        <>
          {prices.currency !== prices.wanted && (
            <p className="text-sm text-gold" data-testid="plans-preview-no-rate">
              {t("noRate", { currency: prices.wanted })}
            </p>
          )}
          <div className="rounded-2xl border border-line bg-canvas p-4 md:p-6" lang={locale}>
            <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone={timeZone}>
              <PreviewCards plans={prices.plans} currency={prices.currency} locale={locale} />
            </NextIntlClientProvider>
          </div>
          <CurrencyPrices
            catalog={catalog}
            addOns={addOns}
            currency={prices.wanted}
            rates={rates}
            onSetManual={onSetManual}
          />
        </>
      ) : (
        <p className="text-sm text-ink-muted">{t("invalid")}</p>
      )}
    </div>
  );
}

function PreviewCards({
  plans,
  currency,
  locale,
}: {
  plans: PlanCatalog;
  currency: string;
  locale: CatalogLocale;
}) {
  const t = useTranslations("marketing.cta");
  return (
    <PricingCards
      flat
      plans={plans}
      currency={currency}
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

type Row = {
  id: string;
  label: string;
  money: CatalogPlan["monthly"];
  /** The price shown: the plan's localized one (a derived year follows the month). */
  shown: number | null;
};

/** The prices of one currency, where each comes from and how far a manual one is from the rate. */
function CurrencyPrices({
  catalog,
  addOns,
  currency,
  rates,
  onSetManual,
}: {
  catalog: PlanCatalog;
  addOns: readonly CatalogAddOn[];
  currency: string;
  rates: RateTable;
  onSetManual?: (currency: string, prices: DerivedPrices) => void;
}) {
  const t = useTranslations("admin.plans.preview");
  const localized = localizePlans(catalog, currency, rates);
  const usable = localized.currency === currency;
  const at = rateDate(rates, currency);
  const money = (value: number, code = currency) => formatPrice(value, code, ADMIN_FORMAT_SETTINGS);
  const percent = (value: number) =>
    formatNumber(Math.abs(value), { style: "percent", decimals: 0 }, ADMIN_FORMAT_SETTINGS);

  const rows: Row[] = [];
  for (const plan of sortedPlans(catalog)) {
    const shown = usable ? localized.plans.find((item) => item.key === plan.key) : undefined;
    const name = planText(plan.name, "cs");
    rows.push({ id: `${plan.key}.monthly`, label: `${name} · ${t("monthly")}`, money: plan.monthly, shown: shown?.monthly[currency] ?? null });
    rows.push({ id: `${plan.key}.yearly`, label: `${name} · ${t("yearly")}`, money: plan.yearly, shown: shown?.yearly[currency] ?? null });
    if (plan.per_worker) {
      rows.push({
        id: `${plan.key}.per_worker`,
        label: `${name} · ${t("perWorker")}`,
        money: plan.per_worker,
        shown: shown?.per_worker?.[currency] ?? null,
      });
    }
  }
  for (const addOn of addOns) {
    const price = addOnPrice(addOn, currency, rates);
    rows.push({
      id: `addon.${addOn.key}`,
      label: `${planText(addOn.name, "cs")} · ${t("monthly")}`,
      money: addOn.monthly,
      shown: price.currency === currency ? price.amount : null,
    });
  }
  const derivedCurrency = currency !== BASE_CURRENCY && rows.some((row) => typeof row.money[currency] !== "number");

  function setManual() {
    if (!onSetManual) return;
    const prices: DerivedPrices = { plans: {}, addOns: {} };
    for (const plan of localized.plans) {
      prices.plans[plan.key] = {
        monthly: plan.monthly[currency],
        yearly: plan.yearly[currency],
        per_worker: plan.per_worker?.[currency],
      };
    }
    for (const addOn of addOns) {
      const price = addOnPrice(addOn, currency, rates);
      if (price.currency === currency) prices.addOns[addOn.key] = price.amount;
    }
    onSetManual(currency, prices);
  }

  return (
    <section className="flex flex-col gap-3" data-testid="plans-currency-prices">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{t("pricesTitle", { currency })}</h3>
        {onSetManual && derivedCurrency && usable && (
          <Button type="button" variant="outline" size="sm" onClick={setManual} data-testid="plans-set-manual">
            {t("setManual", { currency })}
          </Button>
        )}
      </div>
      <p className="text-xs text-ink-muted">
        {currency === BASE_CURRENCY
          ? t("base")
          : at
            ? t("rate", { date: formatDate(new Date(at), ADMIN_FORMAT_SETTINGS) })
            : t("noRateShort")}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted">
              <th className="py-2 pr-4 font-medium">{t("columns.item")}</th>
              <th className="py-2 pr-4 text-right font-medium">{t("columns.price")}</th>
              <th className="py-2 pr-4 font-medium">{t("columns.origin")}</th>
              <th className="py-2 text-right font-medium">{t("columns.exact")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const manual = typeof row.money[currency] === "number";
              const exact = exactPrice(row.money, currency, rates);
              const deviation = manualDeviation(row.money, currency, rates);
              const warn = deviation !== null && Math.abs(deviation) > MANUAL_DEVIATION_WARN;
              return (
                <tr key={row.id} className="border-t border-line/60" data-testid={`plans-price-${row.id}`}>
                  <td className="py-2 pr-4 text-ink-soft">{row.label}</td>
                  <td className="py-2 pr-4 text-right font-semibold text-ink tabular-nums">
                    {row.shown === null ? "–" : money(row.shown)}
                  </td>
                  <td className="py-2 pr-4 text-ink-soft">
                    {manual ? t("manual") : t("derived")}
                    {warn && (
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-gold" data-testid="plans-price-warning">
                        <TriangleAlertIcon aria-hidden className="size-3.5" />
                        {t(deviation > 0 ? "above" : "below", { percent: percent(deviation) })}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right text-ink-muted tabular-nums">
                    {exact === null || currency === BASE_CURRENCY
                      ? "–"
                      : formatNumber(exact, { decimals: 2 }, ADMIN_FORMAT_SETTINGS)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
