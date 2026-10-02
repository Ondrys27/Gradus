"use client";

import { useMemo, useState } from "react";
import { PlusIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { GlowCard } from "@/components/ui/glow-card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MarkSeenOnVisit } from "@/features/game/mark-seen-on-visit";
import { todayIsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useUrlIntent } from "@/lib/use-url-intent";
import { periodRange } from "./finance-logic";
import { InvoicesPanel } from "./invoices-panel";
import { useCan } from "@/features/account/workspace-queries";
import { fetchTransaction } from "./queries";
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

/** `undefined` closed, `null` a new one, otherwise the one being edited. */
type Editing<T> = T | null | undefined;

export function FinanceView({ initialTab = "transactions" }: { initialTab?: FinanceTab }) {
  const t = useTranslations("finance");
  const settings = useFormatSettings();
  const today = todayIsoDate(settings);
  const [tab, setTab] = useState<FinanceTab>(initialTab);
  const [period, setPeriod] = useState<PeriodKind>("thisMonth");
  const [transaction, setTransaction] = useState<Editing<Transaction>>(undefined);
  const [payment, setPayment] = useState<Editing<RecurringPayment>>(undefined);
  const range = useMemo(() => periodRange(period, today), [period, today]);
  // A worker with finance only to look at gets no add, edit or delete.
  const canEdit = useCan("finance", "edit");

  // A link to another tab while Finance is open (e.g. from the search) switches to it.
  const [seenTab, setSeenTab] = useState(initialTab);
  if (initialTab !== seenTab) {
    setSeenTab(initialTab);
    setTab(initialTab);
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
  const tabs = FINANCE_TABS.map((value) => ({ value, label: t(`tabs.${value}`) }));

  return (
    <div className="flex flex-col gap-6">
      <MarkSeenOnVisit section="finance" />
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          tab === "invoices" || !canEdit ? null : (
            <Button onClick={() => (tab === "recurring" ? setPayment(null) : setTransaction(null))}>
              <PlusIcon aria-hidden data-icon="inline-start" />
              {tab === "recurring" ? t("actions.newRecurring") : t("actions.newTransaction")}
            </Button>
          )
        }
      />

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

      <SummaryTiles range={range} />
      <GlowCard interactive={false}>
        <IncomeChart today={today} />
      </GlowCard>

      <Segmented
        label={t("tabs.label")}
        value={tab}
        options={tabs}
        onChange={setTab}
        panelId={() => "finance-panel"}
      />
      <div id="finance-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === "transactions" && (
          // A new period starts the list on its first page again.
          <TransactionsPanel
            key={`${range.from}:${range.to}`}
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
        {tab === "invoices" && <InvoicesPanel readOnly={!canEdit} />}
      </div>

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
