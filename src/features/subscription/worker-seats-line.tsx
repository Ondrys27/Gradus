"use client";

import { UsersIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { isPaidPlanKey, type Billing, type PlanCatalog, type PriceCurrency } from "@/config/pricing";
import { perWorkerPrice } from "@/features/plan/catalog";
import { extraWorkersCharge, workerSeats, type WorkerSeats } from "@/features/plan/worker-seats";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { money } from "./plan-price";
import { useWorkerBilling } from "./queries";

export type WorkerCharge = {
  seats: WorkerSeats;
  /** People counted: everybody not ended (an invite waiting counts as without a plan). */
  workers: number;
  /** Seats the plan's price covers. */
  includedInPlan: number;
  /** The monthly price of one extra worker for this billing; null = the plan takes none. */
  price: number | null;
  /** What the extra workers add to one payment; null = they do not fit the plan. */
  charge: number | null;
};

/**
 * The owner's workers against their plan for one billing and currency.
 * Catalog plans price an extra worker like the plan (yearly with its
 * discount, perWorkerPrice); beta and other keys by the plans table, monthly.
 */
export function useWorkerCharge(
  plans: PlanCatalog,
  billing: Billing,
  currency: PriceCurrency,
  enabled = true,
): WorkerCharge | null {
  const query = useWorkerBilling(enabled);
  if (!query.data) return null;
  const { planKey, terms, workers } = query.data;
  const counted = workers.filter((worker) => worker.status !== "inactive");
  const seats = workerSeats(
    terms,
    counted.map((worker) => ({ id: worker.workerId, ownPlan: worker.ownPlan })),
  );
  const plan = isPaidPlanKey(planKey) ? plans.find((candidate) => candidate.key === planKey) : undefined;
  const price = plan
    ? perWorkerPrice(plan, currency, billing)
    : terms.perWorker
      ? terms.perWorker[currency]
      : null;
  return {
    seats,
    workers: counted.length,
    includedInPlan: terms.included,
    price,
    charge: extraWorkersCharge(seats, price, plan ? billing : "monthly"),
  };
}

/**
 * Settings → Subscription: "Workers: 3 in the price, 2 extra × 290 Kč", and
 * what the extra ones add to a payment. Nothing is charged before a payment
 * gateway exists (TODO(payments) in actions.ts); this is what it would be.
 */
export function WorkerSeatsLine({
  data,
  billing,
  currency,
}: {
  data: WorkerCharge;
  billing: Billing;
  currency: PriceCurrency;
}) {
  const t = useTranslations("subscription.workers");
  const format = useFormatSettings();
  const { seats, price, charge } = data;
  const count = (value: number) => formatNumber(value, {}, format);
  const parts: string[] = [];
  if (data.includedInPlan > 0) {
    parts.push(t("included", { shown: count(seats.included), of: count(data.includedInPlan) }));
  }
  if (seats.extra > 0 || price !== null) {
    parts.push(
      price === null
        ? t("extraNoPrice", { shown: count(seats.extra) })
        : t("extra", { shown: count(seats.extra), price: money(price, currency, format) }),
    );
  }
  if (seats.own > 0) parts.push(t("own", { count: seats.own, shown: count(seats.own) }));

  return (
    <div
      className="flex flex-col gap-2 rounded-xl border border-line/70 bg-surface/40 px-4 py-3"
      data-testid="subscription-workers"
    >
      <p className="flex items-center gap-2 text-sm font-medium text-ink">
        <UsersIcon aria-hidden className="size-4 shrink-0 text-teal" />
        <span className="min-w-0">
          {t("label")}: {data.workers === 0 ? t("none") : parts.join(" · ") || t("none")}
        </span>
      </p>
      {charge === null ? (
        <p className="text-sm text-gold" data-testid="subscription-workers-extra">
          {t("notInPlan")}
        </p>
      ) : (
        <p className="text-sm text-ink-soft" data-testid="subscription-workers-extra">
          {t(billing === "yearly" ? "chargeYearly" : "chargeMonthly", { amount: money(charge, currency, format) })}
        </p>
      )}
      <p className="text-xs text-ink-muted">{t("rule")}</p>
    </div>
  );
}
