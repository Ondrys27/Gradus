"use client";

import { useTranslations } from "next-intl";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { Skeleton } from "@/components/ui/skeleton";
import { RateNote } from "@/features/currency/rate-note";
import { formatCurrency } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { balanceOf, type DateRange } from "./finance-logic";
import { useTotals } from "./queries";

/**
 * Income in teal, expenses in pink, the balance in white. Amounts in other
 * currencies are added at the day's rate (said under the tiles); those
 * without a rate are listed apart, never guessed.
 */
export function SummaryTiles({ range }: { range: DateRange }) {
  const t = useTranslations("finance.summary");
  const format = useFormatSettings();
  const totals = useTotals(range, null);

  if (totals.isError) return <FormAlert>{t("loadFailed")}</FormAlert>;

  const tiles = [
    { key: "income", value: totals.data?.income, className: "text-teal" },
    { key: "expense", value: totals.data?.expense, className: "text-pink" },
    { key: "balance", value: totals.data && balanceOf(totals.data), className: "text-ink" },
  ] as const;

  const data = totals.data;
  return (
    <div className="flex flex-col gap-2">
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <li key={tile.key} className="min-w-0">
            <GlowCard interactive={false} className="@container flex flex-col gap-3">
              <span className="micro-label">{t(tile.key)}</span>
              {tile.value === undefined ? (
                <Skeleton className="h-10 w-2/3" />
              ) : (
                <AnimatedNumber
                  value={tile.value}
                  format={{ style: "currency", decimals: 0 }}
                  className={cn(
                    "stat-number text-[clamp(24px,13cqi,36px)] whitespace-nowrap",
                    tile.className,
                  )}
                />
              )}
            </GlowCard>
          </li>
        ))}
      </ul>
      {data?.converted && data.asOf && <RateNote at={data.asOf} className="px-1" />}
      {data && data.missing.length > 0 && (
        <p className="px-1 text-xs text-ink-muted" data-testid="finance-unconverted">
          {t("unconverted", {
            amounts: data.missing
              .map((row) => formatCurrency(row.income - row.expense, row.currency, format, 0))
              .join(" · "),
          })}
        </p>
      )}
    </div>
  );
}
