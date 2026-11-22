"use client";

import { BanknoteIcon, CalendarClockIcon, HourglassIcon, TrendingUpIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { formatNumber, formatPrice } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { totalsByCurrency } from "./summary";
import type { RewardTotals } from "./types";

/**
 * Earned this month · waiting for approval · waiting for the payout · planned,
 * in the main currency; other currencies in a line below (never added up).
 */
export function RewardsTiles({
  totals,
  isError,
  currency,
}: {
  totals: RewardTotals[] | undefined;
  isError: boolean;
  /** The currency shown in the tiles when there is nothing yet (the plan's). */
  currency: string;
}) {
  const t = useTranslations("workers.rewardPlan.tiles");
  const settings = useFormatSettings();
  if (isError) return <FormAlert>{t("loadFailed")}</FormAlert>;
  if (!totals) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden>
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-32 w-full rounded-card" />
        ))}
      </div>
    );
  }
  const sums = totalsByCurrency(totals);
  const main = sums.find((item) => item.currency === currency) ?? sums[0];
  const code = main?.currency ?? currency;
  const others = sums.filter((item) => item.currency !== code);
  const money = { style: "currency" as const, currency: code };
  const count = (value: number) => formatNumber(value, {}, settings);

  return (
    <div className="flex flex-col gap-2" data-testid="reward-tiles">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={t("earned")}
          value={main?.earned ?? 0}
          format={money}
          tone="gold"
          icon={<TrendingUpIcon />}
        />
        <StatTile
          label={t("pending")}
          value={main?.pending ?? 0}
          format={money}
          tone="violet"
          icon={<HourglassIcon />}
          hint={main?.pendingCount ? t("count", { count: main.pendingCount, shown: count(main.pendingCount) }) : undefined}
        />
        <StatTile
          label={t("approved")}
          value={main?.approved ?? 0}
          format={money}
          tone="teal"
          icon={<BanknoteIcon />}
          hint={main?.approvedCount ? t("count", { count: main.approvedCount, shown: count(main.approvedCount) }) : undefined}
        />
        <StatTile
          label={t("planned")}
          value={main?.planned ?? 0}
          format={money}
          tone="neutral"
          icon={<CalendarClockIcon />}
          hint={main?.plannedCount ? t("count", { count: main.plannedCount, shown: count(main.plannedCount) }) : undefined}
        />
      </div>
      {others.length > 0 && (
        <p className="text-xs text-ink-muted">
          {others
            .map((item) =>
              t("other", {
                currency: item.currency,
                earned: formatPrice(item.earned, item.currency, settings),
                pending: formatPrice(item.pending, item.currency, settings),
                approved: formatPrice(item.approved, item.currency, settings),
                planned: formatPrice(item.planned, item.currency, settings),
              }),
            )
            .join(" · ")}
        </p>
      )}
    </div>
  );
}
