"use client";

import { useTranslations } from "next-intl";
import type { Billing, CatalogPlan, PriceCurrency } from "@/config/pricing";
import { monthlyPrice, perWorkerPrice, yearlyPrice } from "@/features/plan/catalog";
import { formatCurrency, formatNumber, type FormatSettings } from "@/lib/format";

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
  showWorkers = false,
}: {
  plan: CatalogPlan;
  billing: Billing;
  currency: PriceCurrency;
  format: FormatSettings;
  /** The price of a worker under it (WORKER_BILLING_VISIBLE, 28.1). */
  showWorkers?: boolean;
}) {
  const t = useTranslations("subscription.current");
  const price = money(priceOf(plan, billing, currency), currency, format);
  const worker = showWorkers ? perWorkerPrice(plan, currency, billing) : null;
  return (
    <span className="flex flex-col">
      <span>{billing === "yearly" ? t("perYear", { price }) : t("perMonth", { price })}</span>
      {worker !== null && (
        <span className="text-xs font-normal text-ink-soft">
          {plan.included_workers > 0
            ? t("perWorkerIncluded", {
                count: plan.included_workers,
                shown: formatNumber(plan.included_workers, {}, format),
                price: money(worker, currency, format),
              })
            : t("perWorker", { price: money(worker, currency, format) })}
        </span>
      )}
    </span>
  );
}

