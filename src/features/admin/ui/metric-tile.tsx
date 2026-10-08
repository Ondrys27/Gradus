"use client";

import { useTranslations } from "next-intl";
import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatChange, formatMetricValue } from "../format-metric";
import { changeTone, percentChange } from "../numbers";
import type { TileData } from "../types";

/** A tiny line of the values over the period; gaps where there is no value. */
export function Sparkline({
  values,
  className,
}: {
  values: (number | null)[];
  className?: string;
}) {
  const numbers = values.filter((value): value is number => value !== null);
  if (values.length < 2 || numbers.length < 2) return <div className={cn("h-7", className)} />;
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const span = max - min || 1;
  const step = 100 / (values.length - 1);
  let path = "";
  let pen = false;
  values.forEach((value, index) => {
    if (value === null) {
      pen = false;
      return;
    }
    const x = (index * step).toFixed(2);
    const y = (26 - ((value - min) / span) * 24).toFixed(2);
    path += `${pen ? "L" : "M"}${x} ${y} `;
    pen = true;
  });
  return (
    <svg
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      aria-hidden
      className={cn("h-7 w-full overflow-visible text-violet", className)}
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** The change against the previous period, coloured by whether it is good news. */
export function ChangeBadge({
  current,
  previous,
  lowerIsBetter,
  className,
}: {
  current: number | null;
  previous: number | null | undefined;
  lowerIsBetter?: boolean;
  className?: string;
}) {
  const t = useTranslations("admin.tile");
  if (previous === undefined) return null;
  const change = percentChange(current, previous);
  if (change === null) {
    return (
      <span className={cn("text-xs text-ink-muted", className)} title={t("noComparisonHint")}>
        {t("noComparison")}
      </span>
    );
  }
  const tone = changeTone(change, lowerIsBetter);
  const Icon = change > 0.05 ? ArrowUpRightIcon : change < -0.05 ? ArrowDownRightIcon : MinusIcon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums",
        tone === "up" && "text-green",
        tone === "down" && "text-pink",
        tone === "flat" && "text-ink-muted",
        className,
      )}
      title={t("vsPrevious")}
    >
      <Icon aria-hidden className="size-3.5" />
      <span className="sr-only">{t("vsPrevious")}: </span>
      {formatChange(change)}
    </span>
  );
}

/**
 * One number of the registry with its name, the change against the previous
 * period and a small chart of the period.
 */
export function MetricTile({ tile }: { tile: TileData }) {
  const t = useTranslations();
  const tUnits = useTranslations("admin.units");
  const name = t(`metrics.items.${tile.key}.name`);
  const description = t(`metrics.items.${tile.key}.description`);

  return (
    <div
      className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-line bg-surface p-3"
      title={description}
    >
      <span className="micro-label truncate">{name}</span>
      {tile.pending ? (
        <>
          <span className="stat-number text-2xl text-ink-muted">{tUnits("none")}</span>
          <span className="text-xs text-ink-muted">{t("admin.tile.pending")}</span>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="stat-number text-2xl whitespace-nowrap text-ink">
              {formatMetricValue(tile.value, tile.unit, tUnits)}
            </span>
            <ChangeBadge
              current={tile.value}
              previous={tile.previous}
              lowerIsBetter={tile.lowerIsBetter}
            />
          </div>
          {tile.spark ? <Sparkline values={tile.spark} /> : <div className="h-7" />}
        </>
      )}
    </div>
  );
}

export function TileGrid({ tiles }: { tiles: TileData[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
      {tiles.map((tile) => (
        <MetricTile key={tile.key} tile={tile} />
      ))}
    </div>
  );
}
