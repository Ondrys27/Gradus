"use client";

import { useMemo } from "react";
import { useReducedMotion } from "framer-motion";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useLocale, useTranslations } from "next-intl";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatMonthShort, formatMonthYear, formatNumber, isoDateToLocal } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { chartRange } from "./finance-logic";
import { useMonthlyTotals } from "./queries";
import type { IsoDate } from "@/lib/format";

const HEIGHT = 220;

/**
 * Twelve months: income as a teal area, expenses as a violet line. Two series, so a
 * legend names them; the numbers also sit in a table for screen readers.
 */
export function CashflowChart({ today }: { today: IsoDate }) {
  const t = useTranslations("finance.chart");
  const locale = useLocale();
  const settings = useFormatSettings();
  const reduceMotion = useReducedMotion();
  const range = useMemo(() => chartRange(today), [today]);
  const monthly = useMonthlyTotals(range);
  const money = (value: number) => formatCurrency(value, undefined, settings);
  const empty = monthly.data?.every((row) => row.income === 0 && row.expense === 0) ?? false;

  return (
    <GlowCard interactive={false} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="micro-label">{t("title")}</h2>
        <ul className="flex items-center gap-4 text-xs text-ink-soft">
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm bg-teal" />
            {t("income")}
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-3 rounded-full bg-violet" />
            {t("expense")}
          </li>
        </ul>
      </div>

      {monthly.isError ? (
        <FormAlert>{t("loadFailed")}</FormAlert>
      ) : !monthly.data ? (
        <Skeleton style={{ height: HEIGHT }} className="w-full" />
      ) : (
        <figure className="flex flex-col gap-2">
          <div style={{ height: HEIGHT }} aria-hidden className="relative">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthly.data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="finance-income-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-teal)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--color-teal)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--color-line)" strokeOpacity={0.5} />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={12}
                  tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
                  tickFormatter={(value: string) => formatMonthShort(isoDateToLocal(value), locale)}
                />
                <YAxis
                  width={64}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
                  tickFormatter={(value: number) => formatNumber(value, {}, settings)}
                />
                <Tooltip
                  cursor={{ stroke: "var(--color-line-strong)" }}
                  content={({ active, payload }) => {
                    const row = active
                      ? (payload?.[0]?.payload as (typeof monthly.data)[number] | undefined)
                      : undefined;
                    if (!row) return null;
                    return (
                      <div className="rounded-xl border border-line-strong bg-surface px-3 py-2 text-xs shadow-popover">
                        <p className="text-ink-muted">
                          {formatMonthYear(isoDateToLocal(row.month), locale)}
                        </p>
                        <p className="font-semibold text-teal tabular-nums">
                          {t("income")}: {money(row.income)}
                        </p>
                        <p className="font-semibold text-violet tabular-nums">
                          {t("expense")}: {money(row.expense)}
                        </p>
                      </div>
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="income"
                  stroke="var(--color-teal)"
                  strokeWidth={2}
                  fill="url(#finance-income-fill)"
                  isAnimationActive={!reduceMotion}
                />
                <Line
                  type="monotone"
                  dataKey="expense"
                  stroke="var(--color-violet)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={!reduceMotion}
                />
              </ComposedChart>
            </ResponsiveContainer>
            {empty && (
              <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-ink-muted">
                {t("empty")}
              </p>
            )}
          </div>
          <table className="sr-only">
            <caption>{t("title")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("month")}</th>
                <th scope="col">{t("income")}</th>
                <th scope="col">{t("expense")}</th>
              </tr>
            </thead>
            <tbody>
              {monthly.data.map((row) => (
                <tr key={row.month}>
                  <th scope="row">{formatMonthYear(isoDateToLocal(row.month), locale)}</th>
                  <td>{money(row.income)}</td>
                  <td>{money(row.expense)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </figure>
      )}
    </GlowCard>
  );
}
