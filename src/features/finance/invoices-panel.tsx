"use client";

import { useState } from "react";
import { CheckIcon, ExternalLinkIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCelebration } from "@/components/celebration/celebration-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { APP_NAME } from "@/lib/constants";
import { formatCalendarDate, formatCurrency, formatDateTime, todayIsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { fakturoidInvoiceUrl } from "./fakturoid/schema";
import { useInvoiceErrorText } from "./fakturoid/use-invoice-error";
import { decimalsFor, displayInvoiceStatus, pageCount, PAGE_SIZE } from "./finance-logic";
import { Pager } from "./pager";
import {
  useDeleteInvoice,
  useFakturoidStatus,
  useInvoices,
  useMarkInvoicePaid,
  useSyncFakturoid,
} from "./queries";
import { INVOICE_TONE, type Invoice } from "./types";

/**
 * Invoices start from a deal; here they are followed up and marked paid. With
 * Fakturoid connected, its invoices carry a badge and a link, and their state
 * can be pulled in now instead of waiting for the daily sync.
 */
export function InvoicesPanel({ readOnly = false }: { readOnly?: boolean }) {
  const t = useTranslations("finance.invoices");
  const [page, setPage] = useState(0);
  const [deleting, setDeleting] = useState<Invoice | null>(null);
  const query = useInvoices(page);
  const remove = useDeleteInvoice();
  // A failed status read only hides the Fakturoid extras; invoices still work.
  const status = useFakturoidStatus();
  const slug = status.data?.connected ? status.data.slug : null;

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
      {status.data?.connected && !readOnly && <SyncBar lastSyncedAt={status.data.lastSyncedAt} />}
      <ul className="flex flex-col gap-2">
        {query.data.rows.map((invoice) => (
          <li key={invoice.id}>
            <InvoiceRow
              invoice={invoice}
              slug={slug}
              onDelete={readOnly ? undefined : setDeleting}
            />
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
        description={
          deleting?.fakturoid_id
            ? t("deleteDescriptionFakturoid", { number: deleting.number, appName: APP_NAME })
            : t("deleteDescription", { number: deleting?.number ?? "" })
        }
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

function SyncBar({ lastSyncedAt }: { lastSyncedAt: string | null }) {
  const t = useTranslations("finance.invoices");
  const settings = useFormatSettings();
  const sync = useSyncFakturoid();
  const errorText = useInvoiceErrorText();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-ink-muted" role="status">
          {sync.isSuccess
            ? t("syncDone", { paid: sync.data.paid })
            : lastSyncedAt
              ? t("lastSynced", { date: formatDateTime(new Date(lastSyncedAt), settings) })
              : t("neverSynced")}
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={sync.isPending}
          onClick={() => sync.mutate()}
          className="self-start sm:self-auto"
        >
          <RefreshCwIcon
            aria-hidden
            data-icon="inline-start"
            className={cn(sync.isPending && "animate-spin motion-reduce:animate-none")}
          />
          {t("sync")}
        </Button>
      </div>
      {sync.isError && (
        <FormAlert>
          {t("syncFailed")} {errorText(sync.error)}
        </FormAlert>
      )}
    </div>
  );
}

function InvoiceRow({
  invoice,
  slug,
  onDelete,
}: {
  invoice: Invoice;
  slug: string | null;
  /** Absent without the right to edit finance: no paying or deleting. */
  onDelete?: (invoice: Invoice) => void;
}) {
  const t = useTranslations("finance.invoices");
  const settings = useFormatSettings();
  const markPaid = useMarkInvoicePaid();
  const errorText = useInvoiceErrorText();
  const { celebrate } = useCelebration();
  const status = displayInvoiceStatus(invoice, todayIsoDate(settings));
  const payable = (status === "pending" || status === "overdue") && Boolean(onDelete);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink tabular-nums">{invoice.number}</span>
            <StatusPill tone={INVOICE_TONE[status]}>{t(`status.${status}`)}</StatusPill>
            {invoice.fakturoid_id !== null && (
              <StatusPill tone="violet">{t("fakturoid")}</StatusPill>
            )}
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
            {formatCurrency(
              invoice.amount,
              invoice.currency,
              settings,
              decimalsFor(invoice.amount),
            )}
          </span>
          <div className="flex items-center gap-1">
            {payable && (
              <Button
                type="button"
                variant="secondary"
                disabled={markPaid.isPending}
                onClick={() =>
                  markPaid.mutate(invoice.id, {
                    onSuccess: ({ dealMoved }) => {
                      if (dealMoved) {
                        celebrate({
                          title: t("dealWon"),
                          subtitle: invoice.customer_name ?? invoice.number,
                        });
                      }
                    },
                  })
                }
              >
                <CheckIcon aria-hidden data-icon="inline-start" />
                {t("markPaid")}
              </Button>
            )}
            {slug && invoice.fakturoid_id !== null && (
              <a
                href={fakturoidInvoiceUrl(slug, invoice.fakturoid_id)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("openInFakturoid", { number: invoice.number })}
                title={t("openInFakturoid", { number: invoice.number })}
                className={buttonVariants({ variant: "ghost", size: "icon" })}
              >
                <ExternalLinkIcon aria-hidden />
              </a>
            )}
            {onDelete && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("deleteLabel", { number: invoice.number })}
                onClick={() => onDelete(invoice)}
              >
                <Trash2Icon aria-hidden />
              </Button>
            )}
          </div>
        </div>
      </div>
      {markPaid.isError && (
        <FormAlert>
          {t("markPaidFailed")} {errorText(markPaid.error)}
        </FormAlert>
      )}
    </div>
  );
}
