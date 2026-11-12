"use client";

import { useMemo, useState } from "react";
import { PlusIcon } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { GlowCard } from "@/components/ui/glow-card";
import { PageHeader } from "@/components/ui/page-header";
import { KeepHeight } from "@/components/ui/keep-height";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MarkSeenOnVisit } from "@/features/game/mark-seen-on-visit";
import { InvoiceList } from "@/features/invoices/invoice-list";
import { NEW_INVOICE_PATH } from "@/features/invoices/types";
import { todayIsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useUrlIntent } from "@/lib/use-url-intent";
import { periodRange } from "./finance-logic";
import { canDo } from "@/features/account/workspace";
import { useWorkspace } from "@/features/account/workspace-queries";
import { fetchTransaction } from "./queries";
import { MonthView } from "./plan/month-view";
import { planWeekOf, type PlanMonthKey } from "./plan/weeks";
import { RecurringFormDialog } from "./recurring-form-dialog";
import { RecurringPanel } from "./recurring-panel";
import { Segmented } from "./segmented";
import { SummaryTiles } from "./summary-tiles";
import { TransactionFormDialog } from "./transaction-form-dialog";
import { TransactionsPanel } from "./transactions-panel";
import {
  FINANCE_TABS,
  PERIOD_KINDS,
  type FinanceTab,
  type PeriodKind,
  type RecurringPayment,
  type Transaction,
} from "./types";

// The charts library is large; the totals and the transaction list never wait for it.
const IncomeChart = dynamic(() => import("./income-chart").then((module) => module.IncomeChart), {
  ssr: false,
  loading: () => <Skeleton className="h-96 rounded-card" />,
});
const CapitalChart = dynamic(() => import("./plan/capital-chart").then((module) => module.CapitalChart), {
  ssr: false,
  loading: () => <Skeleton className="h-64 rounded-card" />,
});

/** `undefined` closed, `null` a new one, otherwise the one being edited. */
type Editing<T> = T | null | undefined;

export function FinanceView({
  initialTab = "month",
  initialMonth,
  categoryNames = {},
}: {
  initialTab?: FinanceTab;
  /** Category names in every language, for matching transactions to plan rows. */
  categoryNames?: Record<string, string[]>;
  /** "YYYY-MM" from the address (?month=), else the month of today's week. */
  initialMonth?: PlanMonthKey;
}) {
  const t = useTranslations("finance");
  const settings = useFormatSettings();
  const today = todayIsoDate(settings);
  const [requestedTab, setTab] = useState<FinanceTab>(initialTab);
  const [period, setPeriod] = useState<PeriodKind>("thisMonth");
  const [transaction, setTransaction] = useState<Editing<Transaction>>(undefined);
  const [payment, setPayment] = useState<Editing<RecurringPayment>>(undefined);
  const range = useMemo(() => periodRange(period, today), [period, today]);
  const [month, setMonth] = useState<PlanMonthKey>(() => initialMonth ?? planWeekOf(today).month);
  // Finance opens with finance or invoices; inside, each part has its own right.
  const workspace = useWorkspace();
  const canSeeMoney = canDo(workspace, "finance", "view");
  const canSeeSummaries = canDo(workspace, "finance", "summaries");
  const canSeeInvoices = canDo(workspace, "invoices", "view");
  // A worker with finance only to look at gets no add, edit or delete.
  const canEdit = canDo(workspace, "finance", "write");
  const canIssue = canDo(workspace, "invoices", "issue");
  const allowedTabs = FINANCE_TABS.filter((value) =>
    value === "invoices" ? canSeeInvoices : value === "overview" ? canSeeSummaries : canSeeMoney,
  );
  const tab: FinanceTab = allowedTabs.includes(requestedTab)
    ? requestedTab
    : (allowedTabs[0] ?? requestedTab);

  // A link to another tab while Finance is open (e.g. from the search) switches to it.
  const [seenTab, setSeenTab] = useState(initialTab);
  if (initialTab !== seenTab) {
    setSeenTab(initialTab);
    setTab(initialTab);
  }
  const [seenMonth, setSeenMonth] = useState(initialMonth);
  if (initialMonth !== seenMonth) {
    setSeenMonth(initialMonth);
    if (initialMonth) setMonth(initialMonth);
  }

  /** The month stays in the address, so a link (Grady, a reload) opens the same one. */
  function changeMonth(next: PlanMonthKey) {
    setMonth(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "month");
    url.searchParams.set("month", next);
    window.history.replaceState(window.history.state, "", url);
  }
  // The search opens a found transaction for editing, whatever period it is in.
  useUrlIntent("transaction", (id) => {
    setTab("transactions");
    fetchTransaction(id)
      .then((found) => {
        if (found && canEdit) setTransaction(found);
      })
      .catch(() => {});
  });

  const periodItems = PERIOD_KINDS.map((value) => ({ value, label: t(`period.${value}`) }));
  const tabs = allowedTabs.map((value) => ({ value, label: t(`tabs.${value}`) }));

  return (
    <div className="flex flex-col gap-6">
      <MarkSeenOnVisit section="finance" />
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          tab === "invoices" ? (
            canIssue && (
              <Link href={NEW_INVOICE_PATH} data-tutorial="invoice-new" className={buttonVariants()}>
                <PlusIcon aria-hidden data-icon="inline-start" />
                {t("actions.newInvoice")}
              </Link>
            )
          ) : !canEdit || tab === "month" || tab === "overview" ? null : (
            <Button onClick={() => (tab === "recurring" ? setPayment(null) : setTransaction(null))}>
              <PlusIcon aria-hidden data-icon="inline-start" />
              {tab === "recurring" ? t("actions.newRecurring") : t("actions.newTransaction")}
            </Button>
          )
        }
      />

      <Segmented
        label={t("tabs.label")}
        value={tab}
        options={tabs}
        onChange={setTab}
        panelId={() => "finance-panel"}
      />

      {canSeeMoney && (tab === "transactions" || tab === "overview") && (
        <div className="flex flex-col gap-2 sm:max-w-xs">
          <label htmlFor="finance-period" className="text-sm font-medium text-ink-soft">
            {t("period.label")}
          </label>
          <Select
            value={period}
            items={periodItems}
            onValueChange={(next) => {
              if (PERIOD_KINDS.includes(next as PeriodKind)) setPeriod(next as PeriodKind);
            }}
          >
            <SelectTrigger id="finance-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periodItems.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}


      {/* The old tab's height stays until the new one has loaded, so the page does not jump. */}
      <KeepHeight token={tab} id="finance-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === "transactions" && (
          <TransactionsPanel
            range={range}
            onEdit={canEdit ? setTransaction : undefined}
            onCreate={canEdit ? () => setTransaction(null) : undefined}
          />
        )}
        {tab === "recurring" && (
          <RecurringPanel
            onEdit={canEdit ? setPayment : undefined}
            onCreate={canEdit ? () => setPayment(null) : undefined}
          />
        )}
        {tab === "invoices" && <InvoiceList />}
        {tab === "month" && <MonthView month={month} onMonthChange={changeMonth} categoryNames={categoryNames} />}
        {tab === "overview" && canSeeSummaries && (
          <div className="flex flex-col gap-6">
            <SummaryTiles range={range} />
            <GlowCard interactive={false}>
              <IncomeChart today={today} />
            </GlowCard>
            <GlowCard interactive={false}>
              <CapitalChart today={today} />
            </GlowCard>
          </div>
        )}
      </KeepHeight>

      <TransactionFormDialog
        open={transaction !== undefined}
        onOpenChange={(open) => {
          if (!open) setTransaction(undefined);
        }}
        transaction={transaction ?? null}
      />
      <RecurringFormDialog
        open={payment !== undefined}
        onOpenChange={(open) => {
          if (!open) setPayment(undefined);
        }}
        payment={payment ?? null}
      />
    </div>
  );
}
