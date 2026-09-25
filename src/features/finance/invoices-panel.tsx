"use client";

import { useState } from "react";
import { CheckIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { formatCalendarDate, formatCurrency, todayIsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { decimalsFor, displayInvoiceStatus, pageCount, PAGE_SIZE } from "./finance-logic";
import { Pager } from "./pager";
import { useDeleteInvoice, useInvoices, useMarkInvoicePaid } from "./queries";
import { INVOICE_TONE, type Invoice } from "./types";

/** Invoices start from a deal; here they are followed up and marked paid. */
export function InvoicesPanel() {
  const t = useTranslations("finance.invoices");
  const [page, setPage] = useState(0);
  const [deleting, setDeleting] = useState<Invoice | null>(null);
  const query = useInvoices(page);
  const remove = useDeleteInvoice();

  if (query.isError) return <FormAlert>{t("loadFailed")}</FormAlert>;
  if (!query.data) {
    return (
      <div className="flex flex-col gap-2" aria-hidden>
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-20 w-full" />
        ))}
      </div>
    );
  }
  if (query.data.rows.length === 0) {
    return <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {query.data.rows.map((invoice) => (
          <li key={invoice.id}>
            <InvoiceRow invoice={invoice} onDelete={setDeleting} />
          </li>
        ))}
      </ul>
      <Pager page={page} pages={pageCount(query.data.total, PAGE_SIZE)} onPage={setPage} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t("deleteTitle")}
        description={t("deleteDescription", { number: deleting?.number ?? "" })}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        closeLabel={t("close")}
        pending={remove.isPending}
        error={remove.isError ? t("deleteFailed") : null}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) });
        }}
      />
    </div>
  );
}

function InvoiceRow({
  invoice,
  onDelete,
}: {
  invoice: Invoice;
  onDelete: (invoice: Invoice) => void;
}) {
  const t = useTranslations("finance.invoices");
  const settings = useFormatSettings();
  const markPaid = useMarkInvoicePaid();
  const status = displayInvoiceStatus(invoice, todayIsoDate(settings));
  const payable = status === "pending" || status === "overdue";

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-ink tabular-nums">{invoice.number}</span>
          <StatusPill tone={INVOICE_TONE[status]}>{t(`status.${status}`)}</StatusPill>
        </div>
        <p className="truncate text-sm text-ink-soft">{invoice.customer_name ?? t("noClient")}</p>
        <p className="text-xs text-ink-muted">
          {status === "paid" && invoice.paid_on
            ? t("paidOn", { date: formatCalendarDate(invoice.paid_on, settings) })
            : invoice.due_on
              ? t("dueOn", { date: formatCalendarDate(invoice.due_on, settings) })
              : t("noDueDate")}
        </p>
      </div>
      <div className="flex items-center justify-between gap-2 sm:justify-end">
        <span className="text-base font-semibold whitespace-nowrap text-ink tabular-nums">
          {formatCurrency(invoice.amount, invoice.currency, settings, decimalsFor(invoice.amount))}
        </span>
        <div className="flex items-center gap-1">
          {payable && (
            <Button
              type="button"
              variant="secondary"
              disabled={markPaid.isPending}
              onClick={() => markPaid.mutate(invoice.id)}
            >
              <CheckIcon aria-hidden data-icon="inline-start" />
              {t("markPaid")}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("deleteLabel", { number: invoice.number })}
            onClick={() => onDelete(invoice)}
          >
            <Trash2Icon aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
