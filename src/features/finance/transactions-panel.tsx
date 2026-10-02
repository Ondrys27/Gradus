"use client";

import { useState } from "react";
import { CheckIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { FormField } from "@/components/ui/form-field";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { formatCalendarDate, formatCurrency } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { decimalsFor, pageCount, PAGE_SIZE, type DateRange } from "./finance-logic";
import { Pager } from "./pager";
import { useConfirmTransaction, useTransactions } from "./queries";
import { ALL_CATEGORIES, categoryIcon, type Transaction } from "./types";

const ALL = "__all";

type Props = {
  range: DateRange;
  /** Absent without the right to edit finance: the list is read-only. */
  onEdit?: (transaction: Transaction) => void;
  onCreate?: () => void;
};

/** Filtered by the shared period and a category; twenty a page. */
export function TransactionsPanel({ range, onEdit, onCreate }: Props) {
  const t = useTranslations("finance");
  const [category, setCategory] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const query = useTransactions(range, category, page);
  const categoryItems = [
    { value: ALL, label: t("transactions.allCategories") },
    ...ALL_CATEGORIES.map((value) => ({ value, label: t(`categories.${value}`) })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <FormField id="transaction-filter" label={t("transactions.category")} className="sm:max-w-xs">
        <Select
          value={category ?? ALL}
          items={categoryItems}
          onValueChange={(next) => {
            setCategory(!next || next === ALL ? null : next);
            setPage(0);
          }}
        >
          <SelectTrigger id="transaction-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categoryItems.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      {query.isError ? (
        <FormAlert>{t("transactions.loadFailed")}</FormAlert>
      ) : !query.data ? (
        <div className="flex flex-col gap-2" aria-hidden>
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} className="h-16 w-full" />
          ))}
        </div>
      ) : query.data.rows.length === 0 ? (
        <EmptyState
          title={t("transactions.emptyTitle")}
          description={t("transactions.emptyDescription")}
          action={
            onCreate && (
              <Button onClick={onCreate}>
                <PlusIcon aria-hidden data-icon="inline-start" />
                {t("actions.newTransaction")}
              </Button>
            )
          }
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {query.data.rows.map((transaction) => (
              <li key={transaction.id}>
                <TransactionRow transaction={transaction} onEdit={onEdit} />
              </li>
            ))}
          </ul>
          <Pager page={page} pages={pageCount(query.data.total, PAGE_SIZE)} onPage={setPage} />
        </>
      )}
    </div>
  );
}

/** A single row; also used under the income chart for its zoomed-in range. */
export function TransactionRow({
  transaction,
  onEdit,
}: {
  transaction: Transaction;
  onEdit?: (transaction: Transaction) => void;
}) {
  const t = useTranslations("finance");
  const settings = useFormatSettings();
  const confirm = useConfirmTransaction();
  const Icon = categoryIcon(transaction.category);
  const income = transaction.type === "income";
  const title =
    transaction.description ||
    (transaction.category
      ? t(`categories.${transaction.category}`)
      : t(`type.${transaction.type}`));
  const amount = formatCurrency(
    transaction.amount,
    transaction.currency,
    settings,
    decimalsFor(transaction.amount),
  );

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-2xl border bg-surface pr-2",
        transaction.needs_review ? "border-gold/50" : "border-line",
      )}
    >
      <button
        type="button"
        disabled={!onEdit}
        onClick={() => onEdit?.(transaction)}
        className="flex min-h-16 min-w-0 flex-1 cursor-pointer disabled:cursor-default disabled:hover:bg-transparent items-center gap-3 rounded-2xl p-3 text-left outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-violet/40"
      >
        <span
          aria-hidden
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-xl border [&_svg]:size-5",
            income ? "border-teal/30 bg-teal/10 text-teal" : "border-pink/30 bg-pink/10 text-pink",
          )}
        >
          <Icon />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-ink">{title}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
            <span>{formatCalendarDate(transaction.occurred_on, settings)}</span>
            {transaction.source !== "manual" && (
              <span>· {t(`transactions.source.${transaction.source}`)}</span>
            )}
            {transaction.needs_review && (
              <StatusPill tone="gold">{t("transactions.review")}</StatusPill>
            )}
          </span>
        </span>
        <span
          className={cn(
            "shrink-0 text-sm font-semibold whitespace-nowrap tabular-nums",
            income ? "text-teal" : "text-pink",
          )}
        >
          {income ? "+" : "−"}
          {amount}
        </span>
      </button>
      {transaction.needs_review && onEdit && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("transactions.confirm")}
          title={t("transactions.confirm")}
          disabled={confirm.isPending}
          onClick={() => confirm.mutate(transaction.id)}
        >
          <CheckIcon aria-hidden />
        </Button>
      )}
    </div>
  );
}
