"use client";

import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTranslations } from "next-intl";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDayMonth, formatNumber, type IsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useReducedMotionSafe } from "@/lib/use-media-query";
import { capitalSeries } from "./capital-series";
import { useMonthNames } from "./month-view";
import { usePlanMonths, usePlanRangeTransactions } from "./queries";
import { monthSpan, planWeekOf, shiftMonth } from "./weeks";

/** The capital at the end of each week, planned and real, three months back and three ahead. */
export function CapitalChart({ today }: { today: IsoDate }) {
  const t = useTranslations("finance.plan.chart");
  const settings = useFormatSettings();
  const names = useMonthNames();
  const reduceMotion = useReducedMotionSafe();
  const current = planWeekOf(today).month;
  const months = useMemo(() => Array.from({ length: 7 }, (_, index) => shiftMonth(current, index - 3)), [current]);
  const plans = usePlanMonths(months);
  const from = monthSpan(months[0]).from;
  const to = monthSpan(months[6]).to;
  const transactions = usePlanRangeTransactions(from, to, Boolean(plans.data?.length));
  const points = useMemo(
    () => (plans.data ? capitalSeries(plans.data, transactions.data ?? [], today) : []),
    [plans.data, transactions.data, today],
  );
  const currency = points[0]?.currency ?? settings.currency;
  const money = (value: number) => formatCurrency(value, currency, settings);
  const label = (point: (typeof points)[number]) => `${t("week", { week: point.week })} · ${names.title(point.month)}`;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="capital-chart-title">
      <div>
        <h2 id="capital-chart-title" className="text-base font-semibold text-ink">
          {t("title")}
        </h2>
        <p className="text-sm text-ink-muted">{t("description")}</p>
      </div>
      {plans.isError ? (
        <FormAlert>{t("loadFailed")}</FormAlert>
      ) : !plans.data ? (
        <Skeleton className="h-56 rounded-card" />
      ) : points.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("empty")}</p>
      ) : (
        <>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--color-line)" strokeOpacity={0.5} />
                <ReferenceLine y={0} stroke="var(--color-line-strong)" />
                <XAxis
                  dataKey="end"
                  axisLine={false}
                  tickLine={false}
                  minTickGap={16}
                  tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
                  tickFormatter={(value: string) => formatDayMonth(value, settings)}
                />
                <YAxis
                  width={64}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
                  tickFormatter={(value: number) => formatNumber(value, {}, settings)}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    const point = active ? (payload?.[0]?.payload as (typeof points)[number] | undefined) : undefined;
                    if (!point) return null;
                    return (
                      <div className="rounded-xl border border-line-strong bg-surface px-3 py-2 text-xs shadow-popover">
                        <p className="text-ink-muted">{label(point)}</p>
                        <p className="font-semibold text-violet tabular-nums">
                          {t("plan")}: {money(point.plan)}
                        </p>
                        {point.actual !== null && (
                          <p className="font-semibold text-teal tabular-nums">
                            {t("actual")}: {money(point.actual)}
                          </p>
                        )}
                      </div>
                    );
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="plan"
                  stroke="var(--color-violet)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={!reduceMotion}
                />
                <Line
                  type="monotone"
                  dataKey="actual"
                  stroke="var(--color-teal)"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={!reduceMotion}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ul className="flex items-center gap-4 text-xs text-ink-soft">
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-3 rounded-full bg-violet" />
              {t("plan")}
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-3 rounded-full bg-teal" />
              {t("actual")}
            </li>
          </ul>
          <table className="sr-only">
            <caption>{t("title")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("weekColumn")}</th>
                <th scope="col">{t("plan")}</th>
                <th scope="col">{t("actual")}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={`${point.month}-${point.week}`}>
                  <th scope="row">{label(point)}</th>
                  <td>{money(point.plan)}</td>
                  <td>{point.actual === null ? "" : money(point.actual)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
