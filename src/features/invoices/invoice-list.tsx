"use client";

import { useState } from "react";
import Link from "next/link";
import { SearchIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { useHoldHeight } from "@/components/ui/keep-height";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import type { Tone } from "@/components/ui/tone";
import { pageCount } from "@/features/finance/finance-logic";
import { Pager } from "@/features/finance/pager";
import { formatCalendarDate, formatCurrency, todayIsoDate } from "@/lib/format";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { INVOICE_PAGE_SIZE, useInvoiceList } from "./queries";
import { InvoiceSetupGate } from "./setup-wizard";
import { SimpleSelect } from "./simple-select";
import {
  INVOICE_FILTERS,
  INVOICE_SORTS,
  invoiceListStatus,
  invoicePath,
  type InvoiceFilter,
  type InvoiceListRow,
  type InvoiceListStatus,
  type InvoiceSort,
} from "./types";

export const STATUS_TONE: Record<InvoiceListStatus, Tone> = {
  draft: "neutral",
  issued: "gold",
  overdue: "pink",
  paid: "green",
  cancelled: "neutral",
  creditNote: "violet",
};

/** Finance → Invoices: every invoice of the workspace, filtered, searched and sorted in the database. */
export function InvoiceList() {
  const t = useTranslations("invoices.list");
  const settings = useFormatSettings();
  const today = todayIsoDate(settings);
  const [filter, setFilter] = useState<InvoiceFilter>("all");
  const [sort, setSort] = useState<InvoiceSort>("issuedDesc");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const debounced = useDebouncedValue(search.trim(), 250);
  const query = useInvoiceList({ filter, sort, search: debounced, page, today });
  useHoldHeight(!query.data);

  const filters = INVOICE_FILTERS.map((value) => ({ value, label: t(`filter.${value}`) }));
  const sorts = INVOICE_SORTS.map((value) => ({ value, label: t(`sort.${value}`) }));
  const narrowed = filter !== "all" || debounced !== "";

  return (
    <div className="flex flex-col gap-4">
      <InvoiceSetupGate />
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem_12rem]">
        <div className="relative">
          <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
          <Input
            type="search"
            value={search}
            aria-label={t("search")}
            placeholder={t("searchPlaceholder")}
            className="pl-9"
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </div>
        <SimpleSelect
          id="invoice-filter"
          aria-label={t("filterLabel")}
          value={filter}
          options={filters}
          onChange={(value) => {
            setFilter(value as InvoiceFilter);
            setPage(0);
          }}
        />
        <SimpleSelect
          id="invoice-sort"
          aria-label={t("sortLabel")}
          value={sort}
          options={sorts}
          onChange={(value) => {
            setSort(value as InvoiceSort);
            setPage(0);
          }}
        />
      </div>

      {query.isError ? (
        <FormAlert>{t("loadFailed")}</FormAlert>
      ) : !query.data ? (
        <div className="flex flex-col gap-2" aria-hidden>
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-16 w-full" />
          ))}
        </div>
      ) : query.data.rows.length === 0 ? (
        <EmptyState
          title={narrowed ? t("noneFound") : t("emptyTitle")}
          description={narrowed ? t("noneFoundHint") : t("emptyDescription")}
        />
      ) : (
        <>
          <div role="table" aria-label={t("label")} className="flex flex-col">
            <div
              role="row"
              className="hidden grid-cols-[8rem_minmax(0,1fr)_7rem_7rem_9rem_8rem] gap-3 border-b border-line px-3 pb-2 text-xs font-medium text-ink-muted md:grid"
            >
              <span role="columnheader">{t("column.number")}</span>
              <span role="columnheader">{t("column.customer")}</span>
              <span role="columnheader">{t("column.issued")}</span>
              <span role="columnheader">{t("column.due")}</span>
              <span role="columnheader" className="text-right">
                {t("column.total")}
              </span>
              <span role="columnheader" className="text-right">
                {t("column.status")}
              </span>
            </div>
            <div role="rowgroup" className="flex flex-col gap-2 md:gap-0">
              {query.data.rows.map((invoice) => (
                <InvoiceRow key={invoice.id} invoice={invoice} today={today} />
              ))}
            </div>
          </div>
          <Pager page={page} pages={pageCount(query.data.total, INVOICE_PAGE_SIZE)} onPage={setPage} />
        </>
      )}
    </div>
  );
}

function InvoiceRow({ invoice, today }: { invoice: InvoiceListRow; today: string }) {
  const t = useTranslations("invoices.list");
  const settings = useFormatSettings();
  const status = invoiceListStatus(invoice, today);
  const overdue = status === "overdue";
  const date = (value: string | null) => (value ? formatCalendarDate(value, settings) : "—");
  const number = invoice.number ?? t("draftNumber");

  return (
    <Link
      role="row"
      href={invoicePath(invoice.id)}
      aria-label={t("open", { number })}
      className={cn(
        "grid min-h-11 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-2xl border border-line bg-surface p-3 outline-none transition-colors hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
        "md:grid-cols-[8rem_minmax(0,1fr)_7rem_7rem_9rem_8rem] md:items-center md:rounded-none md:border-0 md:border-b md:bg-transparent md:px-3 md:py-2.5",
      )}
    >
      <span role="cell" className={cn("text-sm font-semibold tabular-nums", overdue ? "text-pink" : "text-ink")}>
        {number}
      </span>
      <span role="cell" className="order-3 col-span-2 truncate text-sm text-ink-soft md:order-none md:col-span-1">
        {invoice.customer_name ?? t("noCustomer")}
      </span>
      <span role="cell" className="hidden text-sm text-ink-soft tabular-nums md:block">
        {date(invoice.issued_on)}
      </span>
      <span
        role="cell"
        className={cn(
          "order-4 text-xs tabular-nums md:order-none md:text-sm",
          overdue ? "font-semibold text-pink" : "text-ink-muted md:text-ink-soft",
        )}
      >
        <span className="md:hidden">{t("dueShort")} </span>
        {invoice.kind === "credit_note" ? "—" : date(invoice.due_on)}
      </span>
      <span role="cell" className="order-2 text-right text-sm font-semibold whitespace-nowrap text-ink tabular-nums md:order-none">
        {formatCurrency(invoice.total, invoice.currency, settings, 2)}
      </span>
      <span role="cell" className="order-5 flex justify-end md:order-none">
        <StatusPill tone={STATUS_TONE[status]}>{t(`status.${status}`)}</StatusPill>
      </span>
    </Link>
  );
}
