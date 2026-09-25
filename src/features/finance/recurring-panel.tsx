"use client";

import { PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { formatCalendarDate, formatCurrency, formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { decimalsFor } from "./finance-logic";
import { useRecurringPayments, useToggleRecurring } from "./queries";
import { categoryIcon, type RecurringPayment } from "./types";

type Props = {
  onEdit: (payment: RecurringPayment) => void;
  onCreate: () => void;
};

/** Each payment has a switch; a daily job books the ones that are due. */
export function RecurringPanel({ onEdit, onCreate }: Props) {
  const t = useTranslations("finance.recurring");
  const query = useRecurringPayments();

  if (query.isError) return <FormAlert>{t("loadFailed")}</FormAlert>;
  if (!query.data) {
    return (
      <div className="flex flex-col gap-2" aria-hidden>
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-16 w-full" />
        ))}
      </div>
    );
  }
  if (query.data.length === 0) {
    return (
      <EmptyState
        title={t("emptyTitle")}
        description={t("emptyDescription")}
        action={
          <Button onClick={onCreate}>
            <PlusIcon aria-hidden data-icon="inline-start" />
            {t("new")}
          </Button>
        }
      />
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {query.data.map((payment) => (
        <li key={payment.id}>
          <RecurringRow payment={payment} onEdit={onEdit} />
        </li>
      ))}
    </ul>
  );
}

function RecurringRow({
  payment,
  onEdit,
}: {
  payment: RecurringPayment;
  onEdit: (payment: RecurringPayment) => void;
}) {
  const t = useTranslations("finance");
  const settings = useFormatSettings();
  const toggle = useToggleRecurring();
  const Icon = categoryIcon(payment.category);
  const income = payment.type === "income";
  const ended = payment.ends_on !== null && payment.next_due_on > payment.ends_on;
  const schedule =
    payment.frequency === "weekly" || payment.due_day === null
      ? t(`recurring.frequency.${payment.frequency}`)
      : t("recurring.onDay", {
          frequency: t(`recurring.frequency.${payment.frequency}`),
          day: formatNumber(payment.due_day, {}, settings),
        });

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-2xl border border-line bg-surface pr-4",
        !payment.is_active && "opacity-70",
      )}
    >
      <button
        type="button"
        onClick={() => onEdit(payment)}
        className="flex min-h-16 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-2xl p-3 text-left outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-violet/40"
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
          <span className="truncate text-sm font-medium text-ink">{payment.description}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
            <span>{schedule}</span>
            {ended ? (
              <StatusPill>{t("recurring.ended")}</StatusPill>
            ) : (
              <span>
                · {t("recurring.next", { date: formatCalendarDate(payment.next_due_on, settings) })}
              </span>
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
          {formatCurrency(payment.amount, payment.currency, settings, decimalsFor(payment.amount))}
        </span>
      </button>
      <Switch
        checked={payment.is_active}
        disabled={ended || toggle.isPending}
        aria-label={t("recurring.active", { name: payment.description })}
        onCheckedChange={(active) => toggle.mutate({ id: payment.id, active })}
      />
    </div>
  );
}
