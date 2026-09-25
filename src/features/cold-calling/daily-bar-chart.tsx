"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useLocale, useTranslations } from "next-intl";
import {
  formatCalendarDate,
  formatDayOfMonth,
  formatMonthShort,
  formatMonthYear,
  formatWeekdayShort,
  isoDateToLocal,
} from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import type { Bar as BarDatum, PeriodKind } from "./stats-logic";

type Props = {
  title: string;
  bars: BarDatum[];
  kind: PeriodKind;
  /** The series colour as a design token; today is always gold. */
  color: "violet" | "teal";
  /** Value as shown in the tooltip and the table, e.g. "1 h 05 min". */
  formatValue: (value: number) => string;
  /** Plotted value (e.g. minutes for seconds) and its axis label. */
  plot?: (value: number) => number;
  formatTick: (value: number) => string;
};

const HEIGHT = 168;

/**
 * One series, so no legend: the title names it. Thin columns rounded at the
 * top, square at the baseline; today in gold with "Today" on the axis, so the
 * highlight is never colour alone. Every column has a hover tooltip, and the
 * same numbers sit in a table for screen readers.
 */
export function DailyBarChart({ title, bars, kind, color, formatValue, plot, formatTick }: Props) {
  const t = useTranslations("coldCalling.stats");
  const locale = useLocale();
  const settings = useFormatSettings();
  const data = bars.map((bar) => ({ ...bar, plotted: plot ? plot(bar.value) : bar.value }));

  function axisLabel(key: string, current: boolean) {
    if (current) return kind === "year" ? t("thisMonth") : t("today");
    const date = isoDateToLocal(key);
    if (kind === "week") return formatWeekdayShort(date, locale);
    if (kind === "month") return formatDayOfMonth(date, settings);
    return formatMonthShort(date, locale);
  }
  function fullLabel(key: string) {
    return kind === "year"
      ? formatMonthYear(isoDateToLocal(key), locale)
      : formatCalendarDate(key, settings);
  }

  return (
    <figure className="flex flex-col gap-2">
      <div style={{ height: HEIGHT }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
            barCategoryGap={2}
          >
            <CartesianGrid vertical={false} stroke="var(--color-line)" strokeOpacity={0.5} />
            <XAxis
              dataKey="key"
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={8}
              tick={({ x, y, payload, index }) => {
                const bar = data[index];
                return (
                  <text
                    x={x}
                    y={Number(y) + 12}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={bar?.current ? 600 : 400}
                    fill={bar?.current ? "var(--color-ink)" : "var(--color-ink-muted)"}
                  >
                    {axisLabel(String(payload.value), bar?.current ?? false)}
                  </text>
                );
              }}
            />
            <YAxis
              width={36}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
              tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
              tickFormatter={(value: number) => formatTick(value)}
            />
            <Tooltip
              cursor={{ fill: "var(--color-surface-hover)" }}
              content={({ active, payload }) => {
                const bar = active
                  ? (payload?.[0]?.payload as (typeof data)[number] | undefined)
                  : undefined;
                if (!bar) return null;
                return (
                  <div className="rounded-xl border border-line-strong bg-surface px-3 py-2 text-xs shadow-popover">
                    <p className="text-ink-muted">
                      {bar.current ? `${axisLabel(bar.key, true)} · ` : ""}
                      {fullLabel(bar.key)}
                    </p>
                    <p className="font-semibold text-ink tabular-nums">{formatValue(bar.value)}</p>
                  </div>
                );
              }}
            />
            <Bar dataKey="plotted" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {data.map((bar) => (
                <Cell
                  key={bar.key}
                  fill={bar.current ? "var(--color-gold)" : `var(--color-${color})`}
                  fillOpacity={bar.future ? 0.25 : 1}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {bars
            .filter((bar) => !bar.future)
            .map((bar) => (
              <tr key={bar.key}>
                <th scope="row">{fullLabel(bar.key)}</th>
                <td>{formatValue(bar.value)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </figure>
  );
}
