"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatCalendarDate,
  formatMonthYear,
  formatNumber,
  isoDateToLocal,
  splitDuration,
  todayIsoDate,
  type IsoDate,
} from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { DailyBarChart } from "./daily-bar-chart";
import {
  periodRange,
  summarize,
  toBars,
  type Period,
  type PeriodKind,
  type Range,
  type Summary,
} from "./stats-logic";
import { useDailyMeetings, useDailySeconds } from "./stats-queries";

const KINDS: PeriodKind[] = ["week", "month", "year"];

/** Time on the phone and meetings booked, one period switch for both charts. */
export function StatsCard() {
  const t = useTranslations("coldCalling.stats");
  const locale = useLocale();
  const settings = useFormatSettings();
  const [period, setPeriod] = useState<Period>({ kind: "week", offset: 0 });
  const today = todayIsoDate(settings);
  const range = useMemo(
    () => periodRange(period, today, settings.weekStartsOn),
    [period, today, settings.weekStartsOn],
  );
  const seconds = useDailySeconds(range);
  const meetings = useDailyMeetings(range);
  const n = (value: number, decimals = 0) => formatNumber(value, { decimals }, settings);

  function duration(total: number) {
    const { hours, minutes } = splitDuration(total);
    return hours > 0
      ? t("hoursMinutes", { hours: n(hours), minutes: String(minutes).padStart(2, "0") })
      : t("minutes", { minutes: n(minutes) });
  }
  function count(total: number) {
    return t("meetingCount", { count: total, formatted: n(total) });
  }

  return (
    <GlowCard interactive={false} className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h2 className="micro-label">{t("title")}</h2>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            role="group"
            aria-label={t("period")}
            className="flex rounded-full border border-line p-0.5"
          >
            {KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={period.kind === kind}
                onClick={() => setPeriod({ kind, offset: 0 })}
                className={cn(
                  "h-11 cursor-pointer rounded-full px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-8",
                  period.kind === kind ? "bg-violet/20 text-ink" : "text-ink-soft hover:text-ink",
                )}
              >
                {t(`kinds.${kind}`)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label={t("previous")}
              onClick={() => setPeriod((current) => ({ ...current, offset: current.offset - 1 }))}
              className="grid size-11 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-8"
            >
              <ChevronLeftIcon aria-hidden className="size-4" />
            </button>
            <button
              type="button"
              aria-label={t("next")}
              disabled={period.offset >= 0}
              onClick={() => setPeriod((current) => ({ ...current, offset: current.offset + 1 }))}
              className="grid size-11 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 disabled:cursor-not-allowed disabled:opacity-30 mouse:size-8"
            >
              <ChevronRightIcon aria-hidden className="size-4" />
            </button>
          </div>
        </div>
        <p className="text-sm text-ink-soft" aria-live="polite">
          {rangeLabel(period.kind, range, locale, settings)}
        </p>
      </div>

      <ChartBlock
        title={t("timeTitle")}
        query={seconds}
        period={period}
        range={range}
        today={today}
        formatTotal={duration}
        renderChart={(bars) => (
          <DailyBarChart
            title={t("timeTitle")}
            bars={bars}
            kind={period.kind}
            color="violet"
            formatValue={duration}
            plot={(value) => Math.round(value / 60)}
            formatTick={(value) => n(value)}
          />
        )}
        unitNote={t("axisMinutes")}
      />
      <ChartBlock
        title={t("meetingsTitle")}
        query={meetings}
        period={period}
        range={range}
        today={today}
        formatTotal={count}
        formatAverage={(value) => n(value, 1)}
        renderChart={(bars) => (
          <DailyBarChart
            title={t("meetingsTitle")}
            bars={bars}
            kind={period.kind}
            color="teal"
            formatValue={count}
            formatTick={(value) => n(value)}
          />
        )}
      />
    </GlowCard>
  );

  function rangeLabel(kind: PeriodKind, value: Range, uiLocale: string, format: typeof settings) {
    if (kind === "month") return formatMonthYear(isoDateToLocal(value.from), uiLocale);
    if (kind === "year") return value.from.slice(0, 4);
    return t("range", {
      from: formatCalendarDate(value.from, format),
      to: formatCalendarDate(value.to, format),
    });
  }
}

function ChartBlock({
  title,
  query,
  period,
  range,
  today,
  formatTotal,
  formatAverage,
  renderChart,
  unitNote,
}: {
  title: string;
  query: { data?: Map<IsoDate, number>; isPending: boolean; isError: boolean };
  period: Period;
  range: Range;
  today: IsoDate;
  formatTotal: (value: number) => string;
  /** Averages of small counts need a decimal; durations reuse formatTotal. */
  formatAverage?: (value: number) => string;
  renderChart: (bars: ReturnType<typeof toBars>) => ReactNode;
  unitNote?: string;
}) {
  const t = useTranslations("coldCalling.stats");
  const settings = useFormatSettings();

  let summary: Summary | null = null;
  if (query.data) summary = summarize(range, query.data, today);

  return (
    <section aria-label={title} className="flex flex-col gap-3 border-t border-line pt-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {unitNote && <span className="text-xs text-ink-muted">{unitNote}</span>}
      </div>
      {query.isPending ? (
        <Skeleton className="h-52 rounded-xl" />
      ) : query.isError || !query.data || !summary ? (
        <FormAlert>{t("loadFailed")}</FormAlert>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2">
            <Figure label={t("total")} value={formatTotal(summary.total)} />
            <Figure
              label={t("average")}
              value={formatAverage ? formatAverage(summary.average) : formatTotal(summary.average)}
            />
            <Figure
              label={t("best")}
              value={summary.best ? formatTotal(summary.best.value) : t("none")}
              hint={summary.best ? formatCalendarDate(summary.best.day, settings) : undefined}
            />
          </dl>
          {renderChart(toBars(period.kind, range, query.data, today))}
        </>
      )}
    </section>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="truncate text-base font-semibold text-ink tabular-nums">{value}</dd>
      {hint && <dd className="truncate text-xs text-ink-muted">{hint}</dd>}
    </div>
  );
}
