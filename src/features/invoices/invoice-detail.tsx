"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeftIcon, BanIcon, CheckIcon, DownloadIcon, MailIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { useCan } from "@/features/account/workspace-queries";
import { formatCalendarDate, formatCurrency, formatDateTime, todayIsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { InvoicePaper } from "./document/html";
import type { DocumentInput } from "./document/model";
import { useInvoiceDocument } from "./document/use-document";
import { errorCodeOf } from "./errors";
import { INVOICES_PATH } from "./invoice-editor";
import { STATUS_TONE } from "./invoice-list";
import {
  useCancelInvoice,
  useDownloadInvoicePdf,
  useMarkInvoicePaid,
  type InvoiceWithLinks,
} from "./queries";
import { SendInvoiceDialog } from "./send-invoice-dialog";
import { invoiceListStatus, invoicePath, supplierFromProfile, type InvoiceProfile } from "./types";

/**
 * An issued invoice: never edited again. It is downloaded, sent, marked paid
 * today or cancelled with a credit note; the preview shows it as issued.
 */
export function InvoiceDetail({
  invoice,
  profile,
}: {
  invoice: InvoiceWithLinks;
  profile: InvoiceProfile | null;
}) {
  const t = useTranslations("invoices.detail");
  const tList = useTranslations("invoices.list");
  const tFailure = useTranslations("finance.invoiceErrors");
  const settings = useFormatSettings();
  const canEdit = useCan("finance", "edit");
  const download = useDownloadInvoicePdf();
  const markPaid = useMarkInvoicePaid();
  const cancel = useCancelInvoice();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const status = invoiceListStatus(invoice, todayIsoDate(settings));
  const credit = invoice.kind === "credit_note";
  const unpaid = !credit && (status === "issued" || status === "overdue");
  const total = formatCurrency(invoice.total, invoice.currency, settings, 2);

  const input = useMemo<DocumentInput>(
    () => ({
      kind: invoice.kind,
      number: invoice.number,
      creditForNumber: invoice.creditedNumber,
      issuedOn: invoice.issued_on,
      taxableOn: invoice.taxable_on,
      dueOn: invoice.due_on,
      currency: invoice.currency,
      supplier: invoice.supplier ?? (profile ? supplierFromProfile(profile) : {}),
      customer: invoice.customer,
      items: invoice.items,
      vatMode: invoice.vat_mode,
      variableSymbol: invoice.variable_symbol,
      note: invoice.note,
      style: invoice.style ?? "clean",
      accent: invoice.accent_color,
      qr: invoice.qr_enabled,
      locale: invoice.locale,
    }),
    [invoice, profile],
  );
  const doc = useInvoiceDocument(input);
  const failure = download.error ?? markPaid.error ?? cancel.error;
  const title = credit ? t("titleCreditNote", { number: invoice.number ?? "" }) : t("title", { number: invoice.number ?? "" });

  return (
    <div className="flex flex-col gap-6">
      <Link href={INVOICES_PATH} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2.5 self-start")}>
        <ArrowLeftIcon aria-hidden data-icon="inline-start" />
        {t("back")}
      </Link>
      <PageHeader
        title={title}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <StatusPill tone={STATUS_TONE[status]}>{tList(`status.${status}`)}</StatusPill>
            <span>{[invoice.customer.name, total].filter(Boolean).join(" · ")}</span>
          </span>
        }
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={download.isPending}
              onClick={() => download.mutate(invoice.id)}
            >
              <DownloadIcon aria-hidden data-icon="inline-start" />
              {t("download")}
            </Button>
            {canEdit && (
              <Button type="button" variant="secondary" onClick={() => setSending(true)}>
                <MailIcon aria-hidden data-icon="inline-start" />
                {t("send")}
              </Button>
            )}
            {canEdit && unpaid && (
              <Button type="button" disabled={markPaid.isPending} onClick={() => markPaid.mutate(invoice.id)}>
                <CheckIcon aria-hidden data-icon="inline-start" />
                {t("markPaid")}
              </Button>
            )}
          </>
        }
      />

      <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
        {failure && <FormAlert>{tFailure(errorCodeOf(failure))}</FormAlert>}
        {sent && <p className="text-sm text-green">{t("sent")}</p>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        {doc && <InvoicePaper doc={doc} label={t("previewLabel", { number: invoice.number ?? "" })} />}
        <aside className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 text-sm">
          <Fact label={t("issuedOn")} value={invoice.issued_on ? formatCalendarDate(invoice.issued_on, settings) : "—"} />
          {!credit && (
            <Fact
              label={t("dueOn")}
              value={invoice.due_on ? formatCalendarDate(invoice.due_on, settings) : "—"}
              alert={status === "overdue"}
            />
          )}
          {invoice.paid_on && <Fact label={t("paidOn")} value={formatCalendarDate(invoice.paid_on, settings)} />}
          {invoice.sent_at && <Fact label={t("sentAt")} value={formatDateTime(new Date(invoice.sent_at), settings)} />}
          {invoice.creditNote && (
            <p className="text-ink-soft">
              {t("cancelledBy")}{" "}
              <Link href={invoicePath(invoice.creditNote.id)} className="text-violet underline-offset-4 hover:underline">
                {invoice.creditNote.number}
              </Link>
            </p>
          )}
          {credit && invoice.credited_invoice_id && (
            <p className="text-ink-soft">
              {t("creditFor")}{" "}
              <Link href={invoicePath(invoice.credited_invoice_id)} className="text-violet underline-offset-4 hover:underline">
                {invoice.creditedNumber}
              </Link>
            </p>
          )}
          <p className="text-xs text-ink-muted">{credit ? t("creditHint") : t("frozenHint")}</p>
          {canEdit && unpaid && (
            <Button type="button" variant="ghost" className="self-start text-pink" onClick={() => setConfirmCancel(true)}>
              <BanIcon aria-hidden data-icon="inline-start" />
              {t("cancel")}
            </Button>
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={t("cancelTitle")}
        description={t("cancelDescription", { number: invoice.number ?? "" })}
        confirmLabel={t("cancelConfirm")}
        cancelLabel={t("keep")}
        closeLabel={t("close")}
        pending={cancel.isPending}
        error={cancel.isError ? tFailure(errorCodeOf(cancel.error)) : null}
        onConfirm={() => cancel.mutate(invoice.id, { onSuccess: () => setConfirmCancel(false) })}
      />
      {canEdit && (
        <SendInvoiceDialog
          open={sending}
          onOpenChange={setSending}
          invoice={invoice}
          total={total}
          onSent={() => {
            setSending(false);
            setSent(true);
          }}
        />
      )}
    </div>
  );
}

function Fact({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-ink-muted">{label}</span>
      <span className={cn("font-medium tabular-nums", alert ? "text-pink" : "text-ink")}>{value}</span>
    </div>
  );
}
