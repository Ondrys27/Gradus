"use client";

import { useState, type FormEvent } from "react";
import { BanknoteIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Pager } from "@/features/finance/pager";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { formatCurrency, formatDate, todayIsoDate, type IsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import {
  amountFromInput,
  NOTE_MAX,
  PAGE_SIZE,
  paymentSchema,
  validate,
  type WorkerErrorKey,
} from "./logic";
import { usePayments, useRecordPayment } from "./queries";

/** Payments to a worker, newest first. */
export function PaymentsPanel({ workerId }: { workerId: string }) {
  const t = useTranslations("workers.payments");
  const settings = useFormatSettings();
  const [page, setPage] = useState(0);
  const query = usePayments(workerId, page);

  if (query.isError) return <FormAlert>{t("loadFailed")}</FormAlert>;
  if (!query.data) {
    return (
      <div className="flex flex-col gap-2" aria-hidden>
        {[0, 1].map((key) => (
          <Skeleton key={key} className="h-16 w-full" />
        ))}
      </div>
    );
  }
  if (query.data.rows.length === 0) {
    return (
      <EmptyState icon={<BanknoteIcon />} title={t("emptyTitle")} description={t("emptyDescription")} />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {query.data.rows.map((payment) => (
          <li
            key={payment.id}
            className="flex items-center gap-3 rounded-2xl border border-line bg-surface/70 px-4 py-3"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-green/30 bg-green/10 text-green">
              <BanknoteIcon aria-hidden className="size-4.5" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium text-ink">
                {formatDate(new Date(payment.paid_at), settings)}
              </span>
              {payment.note && (
                <span className="truncate text-xs text-ink-soft">{payment.note}</span>
              )}
            </div>
            <span className="font-semibold text-green tabular-nums">
              {formatCurrency(payment.amount, undefined, settings, payment.amount % 1 === 0 ? 0 : 2)}
            </span>
          </li>
        ))}
      </ul>
      <Pager
        page={page}
        pages={Math.max(1, Math.ceil(query.data.total / PAGE_SIZE))}
        onPage={setPage}
      />
    </div>
  );
}

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workerId: string;
  /** What is still owed, offered as the amount. */
  owed: number;
};

/** Money handed over; the database marks approved earnings paid, oldest first. */
export function PaymentDialog({ open, onOpenChange, workerId, owed }: DialogProps) {
  const t = useTranslations("workers.payments");
  const generation = useFreshOnOpen(open);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("recordTitle")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,440px)]"
    >
      <PaymentFields
        key={generation}
        workerId={workerId}
        owed={owed}
        onDone={() => onOpenChange(false)}
      />
    </ResponsiveDialog>
  );
}

function PaymentFields({
  workerId,
  owed,
  onDone,
}: {
  workerId: string;
  owed: number;
  onDone: () => void;
}) {
  const t = useTranslations("workers.payments");
  const tErrors = useTranslations("workers.errors");
  const settings = useFormatSettings();
  const record = useRecordPayment(workerId);
  const [amount, setAmount] = useState(owed > 0 ? String(owed) : "");
  const [paidOn, setPaidOn] = useState<IsoDate | null>(() => todayIsoDate(settings));
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Partial<Record<string, WorkerErrorKey>>>({});
  const [failed, setFailed] = useState(false);
  const err = (key: string) => (errors[key] ? tErrors(errors[key]) : undefined);
  const today = todayIsoDate(settings);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailed(false);
    const result = validate(paymentSchema, {
      amount: amountFromInput(amount),
      paid_on: paidOn && paidOn <= today ? paidOn : today,
      note,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    try {
      await record.mutateAsync(result.data);
      onDone();
    } catch {
      setFailed(true);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-ink-soft">
        {t("owedNow", { amount: formatCurrency(owed, undefined, settings, owed % 1 === 0 ? 0 : 2) })}
      </p>
      <FormField id="payment-amount" label={t("amount")} error={err("amount")}>
        <Input
          {...fieldA11y("payment-amount", err("amount"))}
          value={amount}
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          onChange={(event) => setAmount(event.target.value)}
        />
      </FormField>
      <FormField id="payment-date" label={t("date")} error={err("paid_on")}>
        <DatePicker id="payment-date" value={paidOn} onValueChange={setPaidOn} />
      </FormField>
      <FormField id="payment-note" label={t("note")} error={err("note")}>
        <Input
          {...fieldA11y("payment-note", err("note"))}
          value={note}
          maxLength={NOTE_MAX + 10}
          autoComplete="off"
          onChange={(event) => setNote(event.target.value)}
        />
      </FormField>
      <p className="text-xs text-ink-muted">{t("settleHint")}</p>
      {failed && <FormAlert>{t("saveFailed")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={record.isPending}>
          {t("record")}
        </Button>
      </div>
    </form>
  );
}
