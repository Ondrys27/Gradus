"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { differenceInCalendarDays, getDaysInMonth } from "date-fns";
import { FileWarningIcon, LineChartIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { toneFill, toneText, type Tone } from "@/components/ui/tone";
import { useSession } from "@/features/account/queries";
import { RateNote } from "@/features/currency/rate-note";
import { compareToPrevious } from "@/features/dashboard/dashboard-logic";
import { useToday } from "@/features/dashboard/queries";
import { IncomeDetail } from "@/features/dashboard/tile-detail";
import {
  periodRange as monthRange,
  type DailyRow,
  type Totals,
} from "@/features/finance/finance-logic";
import { capitalSeries, type CapitalPoint } from "@/features/finance/plan/capital-series";
import { usePlanMonths, usePlanRangeTransactions } from "@/features/finance/plan/queries";
import { monthSpan, planWeekOf, shiftMonth } from "@/features/finance/plan/weeks";
import { useDailyTotals, useTotals } from "@/features/finance/queries";
import { useInvoiceList } from "@/features/invoices/queries";
import { useManagesRewards, useRewardTotals } from "@/features/workers/rewards/queries";
import { totalsByCurrency } from "@/features/workers/rewards/summary";
import {
  formatDayMonth,
  formatNumber,
  formatPrice,
  isoDateToLocal,
  type IsoDate,
  type NumberFormat,
} from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import {
  Actions,
  Columns,
  combine,
  defineWidget,
  Delta,
  Empty,
  Figure,
  Hero,
  Legend,
  LiveNumber,
  Row,
  RowList,
  Segments,
  Side,
  Sparkline,
  Stack,
  Sub,
  useAppeared,
  type WidgetQuery,
  type WidgetViewProps,
} from "@/features/widgets/kit";

// The charts library loads only when the wide capital widget is on screen.
const CapitalChart = dynamic(
  () => import("@/features/finance/plan/capital-chart").then((module) => module.CapitalChart),
  { ssr: false, loading: () => <Skeleton className="h-36 rounded-xl" /> },
);

const FINANCE_PATH = "/app/finance";
const PLAN_HREF = `${FINANCE_PATH}?tab=month`;

/** Money as a `LiveNumber` format: whole amounts without decimals, others with them. */
function moneyFormat(value: number, currency?: string): NumberFormat {
  return { style: "currency", currency, decimals: Number.isInteger(value) ? 0 : 2 };
}

// ---------------------------------------------------------------------------
// The month's money: income, expenses and balance, against last month
// ---------------------------------------------------------------------------

type MonthData = { current: Totals; previous: Totals; days: DailyRow[] };

function useMonthMoney(): WidgetQuery<MonthData> {
  const { today } = useToday();
  const range = monthRange("thisMonth", today);
  const current = useTotals(range, null);
  const previous = useTotals(monthRange("lastMonth", today), null);
  const days = useDailyTotals(range);
  return combine([current, previous, days], () => ({
    current: current.data!,
    previous: previous.data!,
    days: days.data!,
  }));
}

type WeekBucket = { from: number; to: number; income: number; expense: number };

/** The month in weeks of seven days from the 1st (1–7, 8–14, …), the last one shorter. */
function weekBuckets(days: DailyRow[], today: IsoDate): { weeks: WeekBucket[]; current: number } {
  const date = isoDateToLocal(today);
  const inMonth = getDaysInMonth(date);
  const weeks: WeekBucket[] = Array.from({ length: Math.ceil(inMonth / 7) }, (_, index) => ({
    from: index * 7 + 1,
    to: Math.min(index * 7 + 7, inMonth),
    income: 0,
    expense: 0,
  }));
  for (const row of days) {
    const index = Math.floor((Number(row.day.slice(8, 10)) - 1) / 7);
    const week = weeks[index];
    if (!week) continue;
    week.income += row.income;
    week.expense += row.expense;
  }
  return { weeks, current: Math.floor((date.getDate() - 1) / 7) };
}

/**
 * Two columns per week, income in the accent and expenses in grey, the
 * current week full and the others in their wash (the kit's `Columns` draws
 * one series; this is the paired version for the wide widget).
 */
function PairedColumns({
  pairs,
  tone,
  label,
  current,
  labels,
  height = 64,
}: {
  pairs: readonly { a: number; b: number }[];
  tone: Tone;
  label: string;
  current: number;
  labels: readonly string[];
  height?: number;
}) {
  const appeared = useAppeared();
  const max = Math.max(1, ...pairs.flatMap((pair) => [pair.a, pair.b]));
  const grow = (value: number) =>
    appeared ? `${Math.max(value > 0 ? 6 : 2, (value / max) * 100)}%` : "2%";
  return (
    <div role="img" aria-label={label} className="flex min-w-0 flex-col gap-1">
      <div className="flex items-end gap-1.5 border-b border-line/70" style={{ height }}>
        {pairs.map((pair, index) => (
          <span key={index} className="flex min-w-0 flex-1 items-end justify-center gap-[2px]">
            <span
              className={cn(
                "w-full max-w-5 rounded-t-[4px] transition-[height] duration-700 ease-out",
                toneFill[tone],
                index !== current && "opacity-35",
              )}
              style={{ height: grow(pair.a) }}
            />
            <span
              className={cn(
                "w-full max-w-5 rounded-t-[4px] transition-[height] duration-700 ease-out",
                toneFill.neutral,
                index !== current && "opacity-35",
              )}
              style={{ height: grow(pair.b) }}
            />
          </span>
        ))}
      </div>
      <div className="flex gap-1.5" aria-hidden>
        {labels.map((text, index) => (
          <span
            key={index}
            className={cn(
              "min-w-0 flex-1 truncate text-center text-[10px] tabular-nums",
              index === current ? "font-semibold text-ink" : "text-ink-muted",
            )}
          >
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}

function MonthView({ size, data, tone }: WidgetViewProps<MonthData>) {
  const t = useTranslations("dashboard.widgets.financeMonth");
  const tIncome = useTranslations("dashboard.tiles.income");
  const format = useFormatSettings();
  const { today } = useToday();
  const { current, previous } = data;
  const money = (value: number) => formatNumber(value, moneyFormat(value), format);
  const balance = current.income - current.expense;
  const change = compareToPrevious(current.income, previous.income);
  const { weeks, current: thisWeek } = useMemo(() => weekBuckets(data.days, today), [data.days, today]);
  const weekLabels = weeks.map((week) =>
    t("weekLabel", {
      from: formatNumber(week.from, {}, format),
      to: formatNumber(week.to, {}, format),
    }),
  );

  const hero = (heroSize: "lg" | "md") => (
    <Hero size={heroSize}>
      <LiveNumber value={current.income} format={moneyFormat(current.income)} />
    </Hero>
  );
  const delta = (
    <Delta direction={change.direction}>
      {change.direction === "same"
        ? tIncome("same")
        : tIncome(change.direction, { amount: money(change.difference) })}
    </Delta>
  );
  const note = current.converted && current.asOf ? <RateNote at={current.asOf} /> : null;
  const figures = (
    <div className="grid grid-cols-3 gap-2">
      <Figure label={t("income")} value={money(current.income)} className={toneText[tone]} />
      <Figure label={t("expense")} value={money(current.expense)} />
      <Figure
        label={t("balance")}
        value={money(balance)}
        className={balance < 0 ? "text-pink" : undefined}
      />
    </div>
  );

  if (size === "S") {
    return (
      <Stack>
        {hero("lg")}
        <Sub>{t("incomeMonth")}</Sub>
        {note}
      </Stack>
    );
  }

  if (size === "M") {
    // The hero keeps the whole row; the change is the signed amount alone,
    // so it fits beside "Expenses · Balance" even on a phone.
    return (
      <Stack className="gap-1">
        {hero("lg")}
        <Segments
          parts={[
            { key: "income", value: current.income, tone },
            { key: "expense", value: current.expense, tone: "neutral" },
          ]}
          label={t("split")}
        />
        <div className="flex min-w-0 items-center gap-2">
          {change.direction !== "same" && (
            <Delta direction={change.direction}>
              {formatNumber(
                change.direction === "down" ? -change.difference : change.difference,
                { ...moneyFormat(change.difference), signed: true },
                format,
              )}
            </Delta>
          )}
          <Sub className="flex-1">
            {t("expense")} {money(current.expense)} · {t("balance")}{" "}
            <span className={cn("tabular-nums", balance < 0 ? "text-pink" : "text-ink")}>
              {money(balance)}
            </span>
          </Sub>
        </div>
        {note}
      </Stack>
    );
  }

  if (size === "L") {
    return (
      <Stack between>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">{hero("md")}</div>
            {delta}
          </div>
          {figures}
          {note}
        </div>
        <Columns
          values={weeks.map((week) => week.income)}
          tone={tone}
          label={t("weeksChart")}
          current={thisWeek}
          labels={weekLabels}
          height={64}
        />
      </Stack>
    );
  }

  return (
    <Stack>
      <div className="grid min-h-0 flex-1 gap-4 @3xl:grid-cols-2">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">{hero("md")}</div>
            {delta}
          </div>
          {figures}
          {note}
        </div>
        <div className="flex flex-col justify-between gap-2">
          <PairedColumns
            pairs={weeks.map((week) => ({ a: week.income, b: week.expense }))}
            tone={tone}
            label={t("chart")}
            current={thisWeek}
            labels={weekLabels}
          />
          <Legend
            items={[
              { key: "income", label: t("income"), tone, value: money(current.income) },
              { key: "expense", label: t("expense"), tone: "neutral", value: money(current.expense) },
            ]}
          />
        </div>
      </div>
      <Actions
        items={[
          { label: t("openFinance"), href: `${FINANCE_PATH}?tab=transactions`, primary: true },
          { label: t("openPlan"), href: PLAN_HREF },
        ]}
      />
    </Stack>
  );
}

export const financeMonthWidget = defineWidget<MonthData>({
  key: "financeMonth",
  useData: useMonthMoney,
  View: MonthView,
  Detail: () => <IncomeDetail />,
});

// ---------------------------------------------------------------------------
// Capital over the weeks: plan and reality (Finance → Overview's chart)
// ---------------------------------------------------------------------------

type CapitalData = { points: CapitalPoint[] };

/** The same points as the Overview chart, from the plan queries (the chart library stays out). */
function useCapital(): WidgetQuery<CapitalData> {
  const { today } = useToday();
  const current = planWeekOf(today).month;
  const months = useMemo(
    () => Array.from({ length: 7 }, (_, index) => shiftMonth(current, index - 3)),
    [current],
  );
  const plans = usePlanMonths(months);
  const from = monthSpan(months[0]).from;
  const to = monthSpan(months[6]).to;
  const transactions = usePlanRangeTransactions(from, to, Boolean(plans.data?.length));
  const points = useMemo(
    () => (plans.data ? capitalSeries(plans.data, transactions.data ?? [], today) : []),
    [plans.data, transactions.data, today],
  );
  return combine([plans], () => ({ points }));
}

/** Both lines on one scale, 0–1, so they can lie over each other. */
function normalise(points: CapitalPoint[]) {
  const values = points.flatMap((point) =>
    point.actual === null ? [point.plan] : [point.plan, point.actual],
  );
  const min = Math.min(...values);
  const max = Math.max(...values);
  const scale = (value: number) => (max === min ? 0.5 : (value - min) / (max - min));
  return {
    plan: points.map((point) => scale(point.plan)),
    actual: points.map((point) => (point.actual === null ? null : scale(point.actual))),
  };
}

function CapitalView({ size, data, tone }: WidgetViewProps<CapitalData>) {
  const t = useTranslations("dashboard.widgets.capital");
  const format = useFormatSettings();
  const { today } = useToday();
  const { points } = data;

  if (points.length === 0) {
    return (
      <Empty
        icon={LineChartIcon}
        tone={tone}
        title={t("noPlanTitle")}
        hint={size === "M" ? undefined : t("noPlanHint")}
        action={{ label: t("createPlan"), href: PLAN_HREF }}
        compact
      />
    );
  }

  const currency = points[0].currency;
  const money = (value: number) => formatPrice(value, currency, format);
  const latest = [...points].reverse().find((point) => point.actual !== null);
  const heroValue = latest?.actual ?? points[0].plan;
  const ahead = points.filter((point) => point.end >= today);
  const lowest = (ahead.length ? ahead : points).reduce((low, point) =>
    point.plan < low.plan ? point : low,
  );
  const lowestLine = t("lowest", { amount: money(lowest.plan), date: formatDayMonth(lowest.end, format) });
  const lines = normalise(points);
  const hero = (heroSize: "lg" | "md") => (
    <Hero size={heroSize} status={heroValue < 0 ? "bad" : undefined}>
      <LiveNumber value={heroValue} format={moneyFormat(heroValue, currency)} />
    </Hero>
  );

  if (size === "M") {
    return (
      <Side
        aside={
          <Sparkline values={lines.plan} tone={tone} label={t("chart")} className="h-10 w-28" />
        }
      >
        {hero("lg")}
        <Sub>{lowestLine}</Sub>
      </Side>
    );
  }

  if (size === "L") {
    return (
      <Stack between>
        <div className="flex flex-col gap-1">
          {hero("md")}
          <Sub>
            {t("current")} · {lowestLine}
          </Sub>
        </div>
        <div className="flex flex-col gap-2">
          <div className="relative h-24" role="img" aria-label={t("chart")}>
            <Sparkline
              values={lines.plan}
              tone="neutral"
              label={t("plan")}
              className="absolute inset-0 h-full"
            />
            <Sparkline
              values={lines.actual}
              tone={tone}
              label={t("actual")}
              className="absolute inset-0 h-full"
            />
          </div>
          <Legend
            items={[
              {
                key: "actual",
                label: t("actual"),
                tone,
                value: latest ? money(latest.actual ?? 0) : undefined,
              },
              { key: "plan", label: t("plan"), tone: "neutral", value: money(points.at(-1)!.plan) },
            ]}
          />
        </div>
      </Stack>
    );
  }

  return (
    <Stack>
      <div className="flex items-baseline justify-between gap-3">
        {hero("md")}
        <Sub className="text-right">{lowestLine}</Sub>
      </div>
      <CapitalChart today={today} bare chartClassName="h-32" />
      <Actions
        items={[
          { label: t("openPlan"), href: PLAN_HREF, primary: true },
          { label: t("openOverview"), href: `${FINANCE_PATH}?tab=overview` },
        ]}
      />
    </Stack>
  );
}

export const capitalWidget = defineWidget<CapitalData>({
  key: "capital",
  useData: useCapital,
  View: CapitalView,
  Detail: () => {
    const { today } = useToday();
    return <CapitalChart today={today} bare chartClassName="h-72" />;
  },
});

// ---------------------------------------------------------------------------
// Invoices past due (computed, never stored)
// ---------------------------------------------------------------------------

type InvoiceRow = {
  id: string;
  number: string | null;
  customer_name: string | null;
  due_on: string | null;
  total: number;
  currency: string;
};

type InvoicesData = { rows: InvoiceRow[]; total: number };

function useOverdueInvoices(): WidgetQuery<InvoicesData> {
  const { today } = useToday();
  const list = useInvoiceList({ filter: "overdue", search: "", sort: "dueAsc", page: 0, today });
  return combine([list], () => ({ rows: list.data!.rows, total: list.data!.total }));
}

/** Amounts per currency, the currency with most invoices first. Currencies never add up. */
function sumsByCurrency(rows: InvoiceRow[]) {
  const map = new Map<string, { currency: string; total: number; count: number }>();
  for (const row of rows) {
    const sum = map.get(row.currency) ?? { currency: row.currency, total: 0, count: 0 };
    sum.total += row.total;
    sum.count += 1;
    map.set(row.currency, sum);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.total - a.total);
}

function daysOverdue(dueOn: string | null, today: IsoDate): number {
  if (!dueOn) return 0;
  return Math.max(0, differenceInCalendarDays(isoDateToLocal(today), isoDateToLocal(dueOn)));
}

function useInvoiceWords() {
  const t = useTranslations("dashboard.widgets.overdueInvoices");
  const format = useFormatSettings();
  const { today } = useToday();
  return {
    t,
    format,
    today,
    customer: (row: InvoiceRow) => row.customer_name ?? t("noCustomer"),
    overdue: (row: InvoiceRow) => t("daysOverdue", { days: daysOverdue(row.due_on, today) }),
    /** "Total 12 000 Kč · + 2 in EUR", only when every overdue invoice is in the list. */
    sums: (data: InvoicesData) => {
      if (data.rows.length < data.total) return null;
      const [main, ...others] = sumsByCurrency(data.rows);
      if (!main) return null;
      return [
        t("total", { amount: formatPrice(main.total, main.currency, format) }),
        ...others.map((sum) => t("moreCurrencies", { count: sum.count, currency: sum.currency })),
      ].join(" · ");
    },
  };
}

function InvoiceRows({ data, limit }: { data: InvoicesData; limit: number }) {
  const { format, customer, overdue } = useInvoiceWords();
  return (
    <RowList>
      {data.rows.slice(0, limit).map((invoice) => (
        <Row
          key={invoice.id}
          href={`/app/finance/faktury/${invoice.id}`}
          lead={invoice.number ?? ""}
          trail={
            <span className="font-medium text-pink">
              {formatPrice(invoice.total, invoice.currency, format)}
            </span>
          }
        >
          {customer(invoice)}
          <span className="ml-2 text-xs text-ink-muted">{overdue(invoice)}</span>
        </Row>
      ))}
    </RowList>
  );
}

function InvoicesView({ size, data }: WidgetViewProps<InvoicesData>) {
  const { t, format, customer, overdue, sums } = useInvoiceWords();
  if (data.total === 0) {
    return (
      <Empty
        icon={FileWarningIcon}
        tone="green"
        zero={formatNumber(0, {}, format)}
        title={t("count", { count: 0 })}
        hint={t("emptyHint")}
        compact={size === "S"}
      />
    );
  }
  const count = <LiveNumber value={data.total} />;
  const word = t("count", { count: data.total });
  const oldest = data.rows[0];
  const sumLine = sums(data);

  if (size === "S") {
    return (
      <Stack>
        <Hero status="bad">{count}</Hero>
        <Sub>{word}</Sub>
      </Stack>
    );
  }

  if (size === "M") {
    return (
      <Stack className="gap-1">
        <Hero status="bad" unit={word}>
          {count}
        </Hero>
        {sumLine && <Sub>{sumLine}</Sub>}
        {oldest && (
          <Sub className="text-xs text-ink-muted">
            {t("oldest", {
              number: oldest.number ?? "",
              customer: customer(oldest),
              overdue: overdue(oldest),
            })}
          </Sub>
        )}
      </Stack>
    );
  }

  return (
    <Stack>
      <Hero size="md" status="bad" unit={word}>
        {count}
      </Hero>
      {sumLine && <Sub>{sumLine}</Sub>}
      <InvoiceRows data={data} limit={4} />
    </Stack>
  );
}

export const overdueInvoicesWidget = defineWidget<InvoicesData>({
  key: "overdueInvoices",
  useData: useOverdueInvoices,
  View: InvoicesView,
  Detail: ({ data }) => {
    const { t, format } = useInvoiceWords();
    if (data.total === 0) {
      return (
        <Empty
          icon={FileWarningIcon}
          tone="green"
          zero={formatNumber(0, {}, format)}
          title={t("count", { count: 0 })}
          hint={t("emptyHint")}
        />
      );
    }
    return <InvoiceRows data={data} limit={20} />;
  },
});

// ---------------------------------------------------------------------------
// Rewards: to pay out (the owner, or whoever manages rewards); earned and
// planned this month (a worker's own)
// ---------------------------------------------------------------------------

type RewardsData = {
  manages: boolean;
  sums: ReturnType<typeof totalsByCurrency>;
};

function useRewardsData(): WidgetQuery<RewardsData> {
  const { worker } = useSession();
  const manages = useManagesRewards();
  const totals = useRewardTotals(manages ? null : (worker?.id ?? null), manages || Boolean(worker));
  if (!manages && !worker) {
    return {
      data: { manages, sums: [] },
      isPending: false,
      isError: false,
      refetch: () => undefined,
    };
  }
  return combine([totals], () => ({ manages, sums: totalsByCurrency(totals.data ?? []) }));
}

function RewardsView({ size, data, tone }: WidgetViewProps<RewardsData>) {
  const t = useTranslations("dashboard.widgets.rewards");
  const format = useFormatSettings();
  const main = data.sums[0];
  const money = (value: number, currency: string) => formatPrice(value, currency, format);
  const mainWord = data.manages ? t("toPay") : t("earned");

  if (!main) {
    return (
      <Stack>
        <Hero className={toneText[tone]}>{money(0, format.currency)}</Hero>
        <Sub>{data.manages ? t("emptyOwnerTitle") : t("emptyWorkerTitle")}</Sub>
        {size === "L" && (
          <Sub lines={2} className="text-xs text-ink-muted">
            {data.manages ? t("emptyOwnerHint") : t("emptyWorkerHint")}
          </Sub>
        )}
      </Stack>
    );
  }

  const big = data.manages ? main.approved : main.earned;
  const other = data.manages ? main.pending : main.planned;
  const otherLabel = data.manages ? t("toApprove") : t("plannedLabel");
  const hero = (heroSize: "lg" | "md") => (
    <Hero size={heroSize} className={toneText[tone]}>
      <LiveNumber value={big} format={moneyFormat(big, main.currency)} />
    </Hero>
  );

  if (size === "S") {
    return (
      <Stack>
        {hero("lg")}
        <Sub>{mainWord}</Sub>
      </Stack>
    );
  }

  if (size === "M") {
    return (
      <Stack>
        {hero("lg")}
        <Sub>
          {mainWord} · {otherLabel} {money(other, main.currency)}
        </Sub>
        <Segments
          parts={[
            { key: "main", value: big, tone },
            { key: "other", value: other, tone: "neutral" },
          ]}
          label={data.manages ? t("split") : t("splitWorker")}
        />
      </Stack>
    );
  }

  return (
    <Stack>
      {hero("md")}
      <Sub>{mainWord}</Sub>
      <div className="grid grid-cols-2 gap-2">
        <Figure
          label={data.manages ? t("toPayLabel") : t("earnedLabel")}
          value={money(big, main.currency)}
          className={toneText[tone]}
        />
        <Figure label={otherLabel} value={money(other, main.currency)} />
      </div>
      {data.sums.length > 1 && (
        <RowList>
          {data.sums.slice(1).map((sum) => (
            <Row
              key={sum.currency}
              trail={
                <span className={cn("font-medium", toneText[tone])}>
                  {money(data.manages ? sum.approved : sum.earned, sum.currency)}
                </span>
              }
            >
              {sum.currency}
            </Row>
          ))}
        </RowList>
      )}
    </Stack>
  );
}

export const rewardsWidget = defineWidget<RewardsData>({
  key: "rewards",
  useData: useRewardsData,
  View: RewardsView,
  Detail: ({ data, tone }) => {
    const t = useTranslations("dashboard.widgets.rewards");
    const format = useFormatSettings();
    if (data.sums.length === 0) {
      return <RewardsView size="L" data={data} settings={{}} tone={tone} />;
    }
    return (
      <div className="flex flex-col gap-4">
        {data.sums.map((sum) => (
          <div key={sum.currency} className="grid grid-cols-2 gap-3">
            {data.manages ? (
              <>
                <Figure
                  label={t("toPayLabel")}
                  value={formatPrice(sum.approved, sum.currency, format)}
                  className={toneText[tone]}
                />
                <Figure
                  label={t("toApprove")}
                  value={formatPrice(sum.pending, sum.currency, format)}
                />
              </>
            ) : (
              <>
                <Figure
                  label={t("earnedLabel")}
                  value={formatPrice(sum.earned, sum.currency, format)}
                  className={toneText[tone]}
                />
                <Figure
                  label={t("plannedLabel")}
                  value={formatPrice(sum.planned, sum.currency, format)}
                />
              </>
            )}
          </div>
        ))}
      </div>
    );
  },
  useHref: useRewardsHref,
});

function useRewardsHref(): string {
  const manages = useManagesRewards();
  return manages ? "/app/firma?tab=rewards" : "/app/odmeny";
}
