"use client";

import { useTranslations } from "next-intl";
import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatChange, formatMetricValue } from "../format-metric";
import { changeTone, percentChange } from "../numbers";
import type { TileData } from "../types";

/** How many numbers a page shows large; the rest go into the compact strip. */
export const KEY_FIGURES = 4;

/** A tiny line of the values over the period; gaps where there is no value. */
export function Sparkline({
  values,
  className,
}: {
  values: (number | null)[];
  className?: string;
}) {
  const numbers = values.filter((value): value is number => value !== null);
  if (values.length < 2 || numbers.length < 2) return <div className={cn("h-6", className)} />;
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
      className={cn("h-6 w-full overflow-visible text-violet/80", className)}
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * The change against the previous period: an arrow, and colour only where
 * it means something (more sign-ups is green, more cost is pink, a flat line
 * is grey). Nothing at all when there is nothing to compare with.
 */
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
  if (change === null) return <span className="sr-only">{t("noComparison")}</span>;
  const tone = changeTone(change, lowerIsBetter);
  const Icon = change > 0.05 ? ArrowUpRightIcon : change < -0.05 ? ArrowDownRightIcon : MinusIcon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium tabular-nums",
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

/** One of the key numbers of a page: name, value, change and the line of the period. */
export function MetricTile({ tile }: { tile: TileData }) {
  const t = useTranslations();
  const tUnits = useTranslations("admin.units");
  const name = t(`metrics.items.${tile.key}.name`);
  const description = t(`metrics.items.${tile.key}.description`);

  return (
    <div
      className="flex min-w-0 flex-col gap-1 rounded-2xl border border-line bg-surface p-4"
      title={description}
      data-testid="metric-tile"
    >
      <span className="truncate text-xs font-medium text-ink-muted">{name}</span>
      {tile.pending ? (
        <>
          <span className="text-[28px] leading-8 font-semibold text-ink-muted tabular-nums">
            {tUnits("none")}
          </span>
          <span className="text-xs text-ink-muted">{t("admin.tile.pending")}</span>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[28px] leading-8 font-semibold tracking-tight whitespace-nowrap text-ink tabular-nums">
              {formatMetricValue(tile.value, tile.unit, tUnits)}
            </span>
            <ChangeBadge
              current={tile.value}
              previous={tile.previous}
              lowerIsBetter={tile.lowerIsBetter}
            />
          </div>
          {tile.spark ? <Sparkline values={tile.spark} /> : <div className="h-6" />}
        </>
      )}
    </div>
  );
}

/** The numbers beyond the first four: name and value in one compact strip, no chart. */
export function MoreFigures({ tiles }: { tiles: TileData[] }) {
  const t = useTranslations();
  const tUnits = useTranslations("admin.units");
  if (tiles.length === 0) return null;
  return (
    <dl
      className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border border-line bg-surface px-4 py-3 md:grid-cols-3 xl:grid-cols-6"
      aria-label={t("admin.tile.more")}
    >
      {tiles.map((tile) => (
        <div key={tile.key} className="flex min-w-0 flex-col gap-0.5" title={t(`metrics.items.${tile.key}.description`)}>
          <dt className="truncate text-xs text-ink-muted">{t(`metrics.items.${tile.key}.name`)}</dt>
          <dd className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-base font-semibold text-ink tabular-nums">
              {tile.pending ? tUnits("none") : formatMetricValue(tile.value, tile.unit, tUnits)}
            </span>
            {!tile.pending && (
              <ChangeBadge current={tile.value} previous={tile.previous} lowerIsBetter={tile.lowerIsBetter} />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The numbers of a page: the first four large, at the top in the same place
 * on every page; the rest in the compact strip below.
 */
export function Figures({ tiles }: { tiles: TileData[] }) {
  const key = tiles.slice(0, KEY_FIGURES);
  const more = tiles.slice(KEY_FIGURES);
  return (
    <div className="flex flex-col gap-3">
      {/* Always four columns from xl, so the key numbers sit in the same place on every page. */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {key.map((tile) => (
          <MetricTile key={tile.key} tile={tile} />
        ))}
      </div>
      <MoreFigures tiles={more} />
    </div>
  );
}
