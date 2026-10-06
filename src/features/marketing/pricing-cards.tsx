"use client";

import { useState, type ReactNode } from "react";
import { CheckIcon, SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  monthlyPrice,
  PAID_PLANS,
  perWorkerPrice,
  yearlyPrice,
  type Billing,
  type PaidPlan,
  type PriceCurrency,
} from "@/config/pricing";
import { formatCurrency, type FormatSettings } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The three plans side by side, prices from src/config/pricing.ts. Shared by
 * the public pricing page and the plan page in the app; each passes its own
 * button per plan.
 */
export function PricingCards({
  currency,
  formatSettings,
  action,
  footnote,
}: {
  currency: PriceCurrency;
  formatSettings: FormatSettings;
  action: (plan: PaidPlan) => ReactNode;
  /** Replaces the default line under the cards (trial and VAT). */
  footnote?: ReactNode;
}) {
  const t = useTranslations("plans");
  const [billing, setBilling] = useState<Billing>("monthly");
  const money = (value: number) => formatCurrency(value, currency, formatSettings);

  return (
    <div className="flex flex-col gap-6">
      <div
        role="radiogroup"
        aria-label={t("billing.label")}
        className="flex items-center gap-1 self-center rounded-xl border border-line bg-surface/60 p-1"
      >
        {(["monthly", "yearly"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={billing === option}
            onClick={() => setBilling(option)}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-4 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 mouse:min-h-9",
              billing === option ? "bg-violet/20 text-ink" : "text-ink-muted hover:text-ink",
            )}
          >
            {t(`billing.${option}`)}
            {option === "yearly" && (
              <span className="rounded-full bg-teal/15 px-2 py-0.5 text-xs text-teal">
                {t("billing.yearlyNote")}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {PAID_PLANS.map((plan) => (
          <article
            key={plan.key}
            className={cn(
              "relative flex flex-col gap-5 rounded-card border bg-surface p-6",
              plan.recommended ? "border-violet/70 shadow-glow-strong" : "border-line shadow-glow",
            )}
          >
            {plan.recommended && (
              <span className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full bg-violet px-3 py-1 text-xs font-semibold text-white">
                <SparklesIcon aria-hidden className="size-3.5" />
                {t("recommended")}
              </span>
            )}
            <div className="flex flex-col gap-1">
              {/* h2: every caller puts this straight under its own h1/h2, never under an h2 that
                  would make this an h3 — the plan page, the website and /cenik all go h1 or h2
                  then this, so h2 never skips a level. */}
              <h2 className="text-xl font-semibold text-ink">{t(`names.${plan.key}`)}</h2>
              <p className="text-sm text-ink-soft">{t(`taglines.${plan.key}`)}</p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="flex items-baseline gap-2">
                <span className="text-4xl font-bold tracking-tight text-ink">
                  {money(monthlyPrice(plan, currency, billing))}
                </span>
                <span className="text-sm text-ink-muted">{t("perMonth")}</span>
              </p>
              {billing === "yearly" && (
                <p className="text-sm text-ink-muted">
                  {t("billedYearly", { price: money(yearlyPrice(plan, currency)) })}
                </p>
              )}
              {plan.perWorker && (
                <p className="text-sm text-ink-soft">
                  {t("perWorker", { price: money(perWorkerPrice(plan, currency, billing) ?? 0) })}
                </p>
              )}
            </div>
            <ul className="flex flex-1 flex-col gap-2.5">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2.5 text-sm text-ink-soft">
                  <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-teal" />
                  {t(`features.${feature}`, { count: String(plan.monthlyContacts) })}
                </li>
              ))}
            </ul>
            {action(plan)}
          </article>
        ))}
      </div>

      {footnote ?? (
        <p className="text-center text-sm text-ink-muted">
          {t("trialNote")} {t("vatNote")}
        </p>
      )}
    </div>
  );
}
