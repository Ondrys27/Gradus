"use client";

import dynamic from "next/dynamic";
import { CoinsIcon, FileWarningIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/features/account/queries";
import { RateNote } from "@/features/currency/rate-note";
import { compareToPrevious } from "@/features/dashboard/dashboard-logic";
import { Trend } from "@/features/dashboard/dashboard-tile";
import { useToday } from "@/features/dashboard/queries";
import { IncomeDetail } from "@/features/dashboard/tile-detail";
import { periodRange as monthRange, type Totals } from "@/features/finance/finance-logic";
import { useTotals } from "@/features/finance/queries";
import { useInvoiceList } from "@/features/invoices/queries";
import { useManagesRewards, useRewardTotals } from "@/features/workers/rewards/queries";
import { totalsByCurrency } from "@/features/workers/rewards/summary";
import { formatCalendarDate, formatCurrency, formatPrice } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import {
  BigValue,
  combine,
  defineWidget,
  Empty,
  Figure,
  Hint,
  READY,
  Row,
  RowList,
  type WidgetQuery,
} from "../kit";

// The charts library loads only when a chart widget is on screen.
const IncomeChart = dynamic(
  () => import("@/features/finance/income-chart").then((module) => module.IncomeChart),
  { ssr: false, loading: () => <Skeleton className="h-40 rounded-xl" /> },
);
const CapitalChart = dynamic(
  () => import("@/features/finance/plan/capital-chart").then((module) => module.CapitalChart),
  { ssr: false, loading: () => <Skeleton className="h-40 rounded-xl" /> },
);

// ---------------------------------------------------------------------------
// The month's money: income, expenses and balance, against last month
// ---------------------------------------------------------------------------

type MonthData = { current: Totals; previous: Totals };

function useMonthMoney(): WidgetQuery<MonthData> {
  const { today } = useToday();
  const current = useTotals(monthRange("thisMonth", today), null);
  const previous = useTotals(monthRange("lastMonth", today), null);
  return combine([current, previous], () => ({ current: current.data!, previous: previous.data! }));
}

function MonthView({ size, data }: { size: string; data: MonthData }) {
  const t = useTranslations("dashboard.widgets.financeMonth");
  const tIncome = useTranslations("dashboard.tiles.income");
  const format = useFormatSettings();
  const { today } = useToday();
  const { current, previous } = data;
  const money = (value: number) =>
    formatCurrency(value, undefined, format, Number.isInteger(value) ? 0 : 2);
  const change = compareToPrevious(current.income, previous.income);
  const trend = (
    <Trend direction={change.direction}>
      {change.direction === "same"
        ? tIncome("same")
        : tIncome(change.direction, { amount: money(change.difference) })}
    </Trend>
  );
  const note = current.converted && current.asOf ? <RateNote at={current.asOf} /> : null;
  if (size === "S") {
    return (
      <div className="flex flex-col gap-1.5">
        <BigValue>
          <AnimatedNumber value={current.income} format={{ style: "currency" }} />
        </BigValue>
        <Hint>{t("income")}</Hint>
        {note}
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="micro-label">{t("income")}</span>
          <span className="truncate text-lg font-semibold text-green tabular-nums">
            {money(current.income)}
          </span>
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="micro-label">{t("expense")}</span>
          <span className="truncate text-lg font-semibold text-ink tabular-nums">
            {money(current.expense)}
          </span>
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="micro-label">{t("balance")}</span>
          <span
            className={`truncate text-lg font-semibold tabular-nums ${current.income - current.expense < 0 ? "text-pink" : "text-ink"}`}
          >
            {money(current.income - current.expense)}
          </span>
        </div>
      </div>
      {trend}
      {note}
      {size === "XL" && <IncomeChart today={today} />}
    </div>
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

export const capitalWidget = defineWidget<true>({
  key: "capital",
  useData: () => READY,
  View: ({ size }) => {
    const { today } = useToday();
    return (
      <CapitalChart
        today={today}
        bare
        chartClassName={size === "M" ? "h-20" : size === "L" ? "h-52" : "h-56"}
      />
    );
  },
  Detail: () => {
    const { today } = useToday();
    return <CapitalChart today={today} bare chartClassName="h-72" />;
  },
});

// ---------------------------------------------------------------------------
// Invoices past due (computed, never stored)
// ---------------------------------------------------------------------------

type InvoicesData = {
  rows: {
    id: string;
    number: string | null;
    customer_name: string | null;
    due_on: string | null;
    total: number;
    currency: string;
  }[];
  total: number;
};

function useOverdueInvoices(): WidgetQuery<InvoicesData> {
  const { today } = useToday();
  const list = useInvoiceList({ filter: "overdue", search: "", sort: "dueAsc", page: 0, today });
  return combine([list], () => ({ rows: list.data!.rows, total: list.data!.total }));
}

function InvoiceRows({ data, limit }: { data: InvoicesData; limit: number }) {
  const t = useTranslations("dashboard.widgets.overdueInvoices");
  const format = useFormatSettings();
  return (
    <RowList>
      {data.rows.slice(0, limit).map((invoice) => (
        <Row
          key={invoice.id}
          href={`/app/finance/faktury/${invoice.id}`}
          lead={invoice.number ?? ""}
          trail={
            <span className="text-pink">
              {formatPrice(invoice.total, invoice.currency, format)}
            </span>
          }
        >
          {invoice.customer_name ?? t("noCustomer")}
          {invoice.due_on && (
            <span className="ml-2 text-xs text-ink-muted">
              {formatCalendarDate(invoice.due_on, format)}
            </span>
          )}
        </Row>
      ))}
    </RowList>
  );
}

export const overdueInvoicesWidget = defineWidget<InvoicesData>({
  key: "overdueInvoices",
  useData: useOverdueInvoices,
  View: ({ size, data }) => {
    const t = useTranslations("dashboard.widgets.overdueInvoices");
    if (data.total === 0) {
      return (
        <Empty
          icon={FileWarningIcon}
          tone="green"
          title={t("emptyTitle")}
          hint={size === "S" ? undefined : t("emptyHint")}
          compact={size !== "L"}
        />
      );
    }
    return (
      <div className="flex min-h-0 flex-col gap-1.5">
        <BigValue className="text-pink">
          <AnimatedNumber value={data.total} />
        </BigValue>
        <Hint>{t("count", { count: data.total })}</Hint>
        {size !== "S" && <InvoiceRows data={data} limit={size === "L" ? 4 : 1} />}
      </div>
    );
  },
  Detail: ({ data }) => {
    const t = useTranslations("dashboard.widgets.overdueInvoices");
    if (data.total === 0) {
      return (
        <Empty icon={FileWarningIcon} tone="green" title={t("emptyTitle")} hint={t("emptyHint")} />
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

function RewardsBody({ size, data }: { size: string; data: RewardsData }) {
  const t = useTranslations("dashboard.widgets.rewards");
  const format = useFormatSettings();
  const main = data.sums[0];
  const money = (value: number, currency: string) => formatPrice(value, currency, format);
  if (!main) {
    return (
      <Empty
        icon={CoinsIcon}
        tone="gold"
        title={data.manages ? t("emptyOwnerTitle") : t("emptyWorkerTitle")}
        hint={size === "S" ? undefined : data.manages ? t("emptyOwnerHint") : t("emptyWorkerHint")}
        compact={size !== "L"}
      />
    );
  }
  const big = data.manages ? main.approved : main.earned;
  const second = data.manages
    ? t("pendingApproval", { amount: money(main.pending, main.currency) })
    : t("planned", { amount: money(main.planned, main.currency) });
  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      <BigValue className="text-gold">{money(big, main.currency)}</BigValue>
      <Hint>{data.manages ? t("toPay") : t("earned")}</Hint>
      {size !== "S" && <p className="text-sm text-ink-soft">{second}</p>}
      {size === "L" && data.sums.length > 1 && (
        <p className="text-xs text-ink-muted">
          {data.sums
            .slice(1)
            .map((sum) => money(data.manages ? sum.approved : sum.earned, sum.currency))
            .join(" · ")}
        </p>
      )}
    </div>
  );
}

export const rewardsWidget = defineWidget<RewardsData>({
  key: "rewards",
  useData: useRewardsData,
  View: RewardsBody,
  Detail: ({ data }) => {
    const t = useTranslations("dashboard.widgets.rewards");
    const format = useFormatSettings();
    if (data.sums.length === 0) return <RewardsBody size="L" data={data} />;
    return (
      <div className="flex flex-col gap-4">
        {data.sums.map((sum) => (
          <div key={sum.currency} className="grid grid-cols-2 gap-3">
            {data.manages ? (
              <>
                <Figure
                  label={t("toPay")}
                  value={formatPrice(sum.approved, sum.currency, format)}
                  className="text-gold"
                />
                <Figure
                  label={t("toApprove")}
                  value={formatPrice(sum.pending, sum.currency, format)}
                />
              </>
            ) : (
              <>
                <Figure
                  label={t("earned")}
                  value={formatPrice(sum.earned, sum.currency, format)}
                  className="text-gold"
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
