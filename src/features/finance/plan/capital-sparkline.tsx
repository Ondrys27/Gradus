"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";

type Props = {
  /** Closing capital of each week, index 0 = week 1. */
  values: number[];
  currency: string;
  currentWeek: number | null;
  lowestWeek: number;
  /** The lowest point is below zero or below the reserve. */
  warning: boolean;
  reserve: number | null;
  className?: string;
};

const WIDTH = 240;
const HEIGHT = 56;
const PAD_X = 6;
const PAD_Y = 8;

/**
 * A small line of the closing capital week by week under the headline
 * number: the zero line and the reserve as guides, the current week as a
 * filled point, the lowest point marked when it is where the warning comes
 * from. Hover or focus on a point names its week and value.
 */
export function CapitalSparkline({ values, currency, currentWeek, lowestWeek, warning, reserve, className }: Props) {
  const t = useTranslations("finance.plan.summary");
  const settings = useFormatSettings();
  const titleId = useId();
  const money = (value: number) => formatCurrency(value, currency, settings, Number.isInteger(value) ? 0 : 2);
  if (values.length === 0) return null;

  const guides = [0, ...(reserve !== null ? [reserve] : [])];
  const min = Math.min(...values, ...guides);
  const max = Math.max(...values, ...guides);
  const span = max - min || 1;
  const x = (index: number) => PAD_X + (index * (WIDTH - PAD_X * 2)) / Math.max(1, values.length - 1);
  const y = (value: number) => PAD_Y + ((max - value) / span) * (HEIGHT - PAD_Y * 2);
  const path = values.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");
  const description = values.map((value, index) => t("weekPoint", { week: index + 1, value: money(value) })).join(", ");

  return (
    <svg
      role="img"
      aria-labelledby={titleId}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className={cn("block h-14 w-full overflow-visible", className)}
      data-testid="plan-summary-sparkline"
    >
      <title id={titleId}>{`${t("sparkline")}: ${description}`}</title>
      <line
        x1={0}
        x2={WIDTH}
        y1={y(0)}
        y2={y(0)}
        stroke="var(--color-line-strong)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {reserve !== null && reserve !== 0 && (
        <line
          x1={0}
          x2={WIDTH}
          y1={y(reserve)}
          y2={y(reserve)}
          stroke="var(--color-ink-muted)"
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        >
          <title>{t("reserveLine", { value: money(reserve) })}</title>
        </line>
      )}
      <path
        d={path}
        fill="none"
        stroke="var(--color-violet)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {values.map((value, index) => {
        const week = index + 1;
        const lowest = warning && week === lowestWeek;
        const current = week === currentWeek;
        const color = lowest ? "var(--color-pink)" : "var(--color-violet)";
        return (
          <g key={week} tabIndex={0} className="outline-none focus-visible:[&>circle:last-child]:stroke-ink">
            <title>{t("weekPoint", { week, value: money(value) })}</title>
            {/* A hit target wider than the mark. */}
            <circle cx={x(index)} cy={y(value)} r={10} fill="transparent" />
            <circle
              cx={x(index)}
              cy={y(value)}
              r={current || lowest ? 4 : 3}
              fill={current || lowest ? color : "var(--color-surface)"}
              stroke={color}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
    </svg>
  );
}
