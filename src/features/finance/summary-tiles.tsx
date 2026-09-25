"use client";

import { useTranslations } from "next-intl";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { balanceOf, type DateRange } from "./finance-logic";
import { useTotals } from "./queries";

/** Income in teal, expenses in pink, the balance in white. */
export function SummaryTiles({ range }: { range: DateRange }) {
  const t = useTranslations("finance.summary");
  const totals = useTotals(range, null);

  if (totals.isError) return <FormAlert>{t("loadFailed")}</FormAlert>;

  const tiles = [
    { key: "income", value: totals.data?.income, className: "text-teal" },
    { key: "expense", value: totals.data?.expense, className: "text-pink" },
    { key: "balance", value: totals.data && balanceOf(totals.data), className: "text-ink" },
  ] as const;

  return (
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
  );
}
