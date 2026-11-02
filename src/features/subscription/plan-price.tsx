"use client";

import { useTranslations } from "next-intl";
import type { Billing, CatalogPlan, PriceCurrency } from "@/config/pricing";
import { monthlyPrice, perWorkerPrice, yearlyPrice } from "@/features/plan/catalog";
import { formatCurrency, type FormatSettings } from "@/lib/format";

export function money(value: number, currency: string, format: FormatSettings): string {
  return formatCurrency(value, currency, format, Number.isInteger(value) ? 0 : 2);
}

/** What a period of the plan costs: the month, or the whole year. */
export function priceOf(plan: CatalogPlan, billing: Billing, currency: PriceCurrency): number {
  return billing === "yearly" ? yearlyPrice(plan, currency) : monthlyPrice(plan, currency, "monthly");
}

export function PlanPrice({
  plan,
  billing,
  currency,
  format,
}: {
  plan: CatalogPlan;
  billing: Billing;
  currency: PriceCurrency;
  format: FormatSettings;
}) {
  const t = useTranslations("subscription.current");
  const price = money(priceOf(plan, billing, currency), currency, format);
  const worker = perWorkerPrice(plan, currency, billing);
  return (
    <span className="flex flex-col">
      <span>{billing === "yearly" ? t("perYear", { price }) : t("perMonth", { price })}</span>
      {worker !== null && (
        <span className="text-xs font-normal text-ink-soft">
          {t("perWorker", { price: money(worker, currency, format) })}
        </span>
      )}
    </span>
  );
}

