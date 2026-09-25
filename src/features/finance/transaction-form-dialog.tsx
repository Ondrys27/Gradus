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
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { todayIsoDate, type IsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { amountToInput } from "./finance-logic";
import { defaultCategory, MoneyFields, type MoneyDraft } from "./money-fields";
import { useDeleteTransaction, useSaveTransaction } from "./queries";
import { validateTransaction, type FinanceErrorKey } from "./schemas";
import type { Transaction } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing this one, or a new transaction when null. */
  transaction: Transaction | null;
};

export function TransactionFormDialog({ open, onOpenChange, transaction }: Props) {
  const t = useTranslations("finance.form");
  const generation = useFreshOnOpen(open);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={transaction ? t("editTransaction") : t("newTransaction")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,480px)]"
    >
      <Fields key={generation} transaction={transaction} onDone={() => onOpenChange(false)} />
    </ResponsiveDialog>
  );
}

function Fields({ transaction, onDone }: { transaction: Transaction | null; onDone: () => void }) {
  const t = useTranslations("finance.form");
  const tErrors = useTranslations("finance.errors");
  const settings = useFormatSettings();
  const save = useSaveTransaction();
  const remove = useDeleteTransaction();
  const [draft, setDraft] = useState<MoneyDraft>(() =>
    transaction
      ? {
          type: transaction.type,
          amount: amountToInput(transaction.amount),
          category: transaction.category,
          description: transaction.description ?? "",
        }
      : { type: "expense", amount: "", category: defaultCategory("expense"), description: "" },
  );
  const [date, setDate] = useState<IsoDate | null>(
    () => transaction?.occurred_on ?? todayIsoDate(settings),
  );
  const [errors, setErrors] = useState<Partial<Record<string, FinanceErrorKey>>>({});
  const [failed, setFailed] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailed(false);
    const result = validateTransaction({
      ...draft,
      currency: transaction?.currency ?? settings.currency,
      occurred_on: date,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    try {
      await save.mutateAsync({ id: transaction?.id, input: result.data });
      onDone();
    } catch {
      setFailed(true);
    }
  }

  async function confirmDelete() {
    if (!transaction) return;
    try {
      await remove.mutateAsync(transaction.id);
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
        idPrefix="transaction"
        draft={draft}
        errors={errors}
        onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
      />
      <FormField
        id="transaction-date"
        label={t("date")}
        error={errors.occurred_on && tErrors(errors.occurred_on)}
      >
        <DatePicker id="transaction-date" value={date} onValueChange={setDate} />
      </FormField>
      {failed && <FormAlert>{t("saveFailed")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {transaction && (
          <Button
            type="button"
            variant="destructive"
            className="sm:mr-auto"
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2Icon aria-hidden data-icon="inline-start" />
            {t("delete")}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {t("save")}
        </Button>
      </div>
    </form>
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t("deleteTransactionTitle")}
        description={t("deleteTransactionDescription")}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        closeLabel={t("close")}
        pending={remove.isPending}
        error={remove.isError ? t("deleteFailed") : null}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
