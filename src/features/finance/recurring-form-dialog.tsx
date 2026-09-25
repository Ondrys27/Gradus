"use client";

import { useState, type FormEvent } from "react";
import { Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { FormAlert } from "@/components/ui/form-alert";
import { FormField } from "@/components/ui/form-field";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { todayIsoDate, type IsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { amountToInput } from "./finance-logic";
import { defaultCategory, MoneyFields, type MoneyDraft } from "./money-fields";
import { useDeleteRecurring, useSaveRecurring } from "./queries";
import { validateRecurring, type FinanceErrorKey } from "./schemas";
import { FREQUENCIES, type Frequency, type RecurringPayment } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: RecurringPayment | null;
};

export function RecurringFormDialog({ open, onOpenChange, payment }: Props) {
  const t = useTranslations("finance.form");
  const generation = useFreshOnOpen(open);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={payment ? t("editRecurring") : t("newRecurring")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,480px)]"
    >
      <Fields key={generation} payment={payment} onDone={() => onOpenChange(false)} />
    </ResponsiveDialog>
  );
}

function Fields({ payment, onDone }: { payment: RecurringPayment | null; onDone: () => void }) {
  const t = useTranslations("finance");
  const settings = useFormatSettings();
  const save = useSaveRecurring();
  const remove = useDeleteRecurring();
  const [draft, setDraft] = useState<MoneyDraft>(() =>
    payment
      ? {
          type: payment.type,
          amount: amountToInput(payment.amount),
          category: payment.category,
          description: payment.description,
        }
      : { type: "expense", amount: "", category: defaultCategory("expense"), description: "" },
  );
  const [frequency, setFrequency] = useState<Frequency>(payment?.frequency ?? "monthly");
  const [nextDue, setNextDue] = useState<IsoDate | null>(
    () => payment?.next_due_on ?? todayIsoDate(settings),
  );
  const [endsOn, setEndsOn] = useState<IsoDate | null>(payment?.ends_on ?? null);
  const [errors, setErrors] = useState<Partial<Record<string, FinanceErrorKey>>>({});
  const [failed, setFailed] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const frequencies = FREQUENCIES.map((value) => ({
    value,
    label: t(`recurring.frequency.${value}`),
  }));
  const err = (key: string) => (errors[key] ? t(`errors.${errors[key]}`) : undefined);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailed(false);
    const result = validateRecurring({
      ...draft,
      currency: payment?.currency ?? settings.currency,
      frequency,
      next_due_on: nextDue,
      ends_on: endsOn,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    try {
      await save.mutateAsync({ id: payment?.id, input: result.data });
      onDone();
    } catch {
      setFailed(true);
    }
  }

  async function confirmDelete() {
    if (!payment) return;
    try {
      await remove.mutateAsync(payment.id);
      setConfirmingDelete(false);
      onDone();
    } catch {
      // The dialog shows the error and stays open.
    }
  }

  return (
    <>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <MoneyFields
          idPrefix="recurring"
          draft={draft}
          errors={errors}
          descriptionRequired
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        />
        <FormField id="recurring-frequency" label={t("recurring.frequencyLabel")}>
          <Select
            value={frequency}
            items={frequencies}
            onValueChange={(next) => {
              if (FREQUENCIES.includes(next as Frequency)) setFrequency(next as Frequency);
            }}
          >
            <SelectTrigger id="recurring-frequency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {frequencies.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField
          id="recurring-next"
          label={t("recurring.nextDue")}
          hint={frequency === "weekly" ? undefined : t("recurring.dayHint")}
          error={err("next_due_on")}
        >
          <DatePicker id="recurring-next" value={nextDue} onValueChange={setNextDue} />
        </FormField>
        <FormField id="recurring-ends" label={t("recurring.endsOn")} error={err("ends_on")}>
          <DatePicker id="recurring-ends" value={endsOn} onValueChange={setEndsOn} />
        </FormField>
        {failed && <FormAlert>{t("form.saveFailed")}</FormAlert>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {payment && (
            <Button
              type="button"
              variant="destructive"
              className="sm:mr-auto"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2Icon aria-hidden data-icon="inline-start" />
              {t("form.delete")}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onDone}>
            {t("form.cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {t("form.save")}
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t("form.deleteRecurringTitle")}
        description={t("form.deleteRecurringDescription")}
        confirmLabel={t("form.delete")}
        cancelLabel={t("form.cancel")}
        closeLabel={t("form.close")}
        pending={remove.isPending}
        error={remove.isError ? t("form.deleteFailed") : null}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
