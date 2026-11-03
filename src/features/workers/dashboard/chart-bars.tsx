"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useLocale } from "next-intl";
import {
  formatCalendarDate,
  formatDayMonth,
  formatMonthShort,
  formatMonthYear,
  formatWeekdayShort,
  isoDateToLocal,
  type IsoDate,
} from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import type { BucketUnit } from "./chart-logic";

/** A series of the chart, coloured by a design token (never a hex). */
export type ChartBarSeries<K extends string> = {
  key: K;
  label: string;
  color: "green" | "orange" | "pink" | "violet" | "teal" | "gold";
};

type Props<K extends string> = {
  title: string;
  rows: ({ key: IsoDate } & Record<K, number>)[];
  series: ChartBarSeries<K>[];
  unit: BucketUnit;
  /** Stacked (parts of one whole) or side by side (separate counts). */
  stacked?: boolean;
  /** Seven daily bars read best as weekday names. */
  weekdays?: boolean;
  formatValue: (value: number) => string;
  height?: number;
  /** Room for the longest value on the axis (money needs more). */
  axisWidth?: number;
};

/** About this many labels fit on the axis of the narrow dashboard. */
const MAX_TICKS = 7;

/**
 * Columns over time for the dashboard: thin bars rounded at the data end,
 * a 2 px gap between the parts of a stack, one axis, a recessive grid. A
 * legend names every series (identity is never colour alone), each column
 * has a tooltip with all its numbers, and a table repeats them for screen
 * readers.
 */
export function ChartBars<K extends string>({
  title,
  rows,
  series,
  unit,
  stacked = false,
  weekdays = false,
  formatValue,
  height = 200,
  axisWidth = 44,
}: Props<K>) {
  const locale = useLocale();
  const settings = useFormatSettings();

  function tickLabel(key: IsoDate) {
    if (unit === "month") return formatMonthShort(isoDateToLocal(key), locale);
    if (weekdays) return formatWeekdayShort(isoDateToLocal(key), locale);
    return formatDayMonth(key, settings);
  }
  function fullLabel(key: IsoDate) {
    if (unit === "month") return formatMonthYear(isoDateToLocal(key), locale);
    return formatCalendarDate(key, settings);
  }
  const step = Math.max(1, Math.ceil(rows.length / MAX_TICKS));
  const ticks = rows
    .filter((_, index) => (rows.length - 1 - index) % step === 0)
    .map((row) => row.key);

  return (
    <figure className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
        {series.map((item) => (
          <li key={item.key} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2.5 rounded-[3px]"
              style={{ background: `var(--color-${item.color})` }}
            />
            {item.label}
          </li>
        ))}
      </ul>
      <div style={{ height }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
            barCategoryGap="20%"
            barGap={2}
          >
            <CartesianGrid vertical={false} stroke="var(--color-line)" strokeOpacity={0.5} />
            <XAxis
              dataKey="key"
              axisLine={false}
              tickLine={false}
              ticks={ticks}
              interval={0}
              tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
              tickFormatter={(value: string) => tickLabel(value)}
            />
            <YAxis
              width={axisWidth}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
              tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
              tickFormatter={(value: number) => formatValue(value)}
            />
            <Tooltip
              cursor={{ fill: "var(--color-surface-hover)" }}
              content={({ active, payload }) => {
                const row = active
                  ? (payload?.[0]?.payload as Props<K>["rows"][number] | undefined)
                  : undefined;
                if (!row) return null;
                return (
                  <div className="flex flex-col gap-1 rounded-xl border border-line-strong bg-surface px-3 py-2 text-xs shadow-popover">
                    <p className="text-ink-muted">{fullLabel(row.key)}</p>
                    {series.map((item) => (
                      <p key={item.key} className="flex items-center gap-2 text-ink-soft">
                        <span
                          aria-hidden
                          className="size-2 rounded-[2px]"
                          style={{ background: `var(--color-${item.color})` }}
                        />
                        <span className="flex-1">{item.label}</span>
                        <span className="font-semibold text-ink tabular-nums">
                          {formatValue(row[item.key])}
                        </span>
                      </p>
                    ))}
                  </div>
                );
              }}
            />
            {series.map((item, index) => {
              const top = !stacked || index === series.length - 1;
              return (
                <Bar
                  key={item.key}
                  dataKey={item.key}
                  stackId={stacked ? "stack" : undefined}
                  fill={`var(--color-${item.color})`}
                  // The surface gap between the parts of a stack.
                  stroke={stacked ? "var(--color-surface)" : undefined}
                  strokeWidth={stacked ? 2 : 0}
                  radius={top ? [4, 4, 0, 0] : 0}
                  maxBarSize={stacked ? 24 : 12}
                  isAnimationActive={false}
                />
              );
            })}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className={cn("sr-only")}>
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col" />
            {series.map((item) => (
              <th key={item.key} scope="col">
                {item.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{fullLabel(row.key)}</th>
              {series.map((item) => (
                <td key={item.key}>{formatValue(row[item.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
