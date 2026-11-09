"use client";

import { useState } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatCurrency, formatDayMonth } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { decimalMarkOf, parseAmountInput } from "./amount-input";
import type { SheetSummary } from "./sheet";
import type { PlanWeek } from "./weeks";

type Props = {
  summary: SheetSummary;
  weeks: PlanWeek[];
  currency: string;
  reserve: number | null;
  canEdit: boolean;
  onSaveReserve: (value: number | null) => void;
};

/**
 * Shrnutí měsíce: on wide screens a column right of the table, on phones
 * cards above it. The lowest point names its week; below zero or below the
 * reserve it warns.
 */
export function SummaryPanel({ summary, weeks, currency, reserve, canEdit, onSaveReserve }: Props) {
  const t = useTranslations("finance.plan.summary");
  const settings = useFormatSettings();
  const money = (value: number) =>
    formatCurrency(value, currency, settings, Number.isInteger(value) ? 0 : 2);
  const lowestWeek = weeks[summary.lowest.week - 1];
  const items = [
    { key: "opening", value: summary.opening },
    { key: "income", value: summary.income },
    { key: "expense", value: summary.expense },
    { key: "balance", value: summary.balance },
    { key: "closing", value: summary.closing, strong: true },
  ] as const;

  return (
    <aside aria-label={t("title")} className="flex flex-col gap-3" data-testid="finance-plan-summary">
      <h2 className="text-sm font-semibold text-ink">{t("title")}</h2>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1">
        {items.map((item) => (
          <div key={item.key} className="rounded-xl border border-line bg-surface px-3 py-2">
            <dt className="text-xs text-ink-muted">{t(item.key)}</dt>
            <dd
              data-testid={`plan-summary-${item.key}`}
              className={cn(
                "tabular-nums",
                "strong" in item && item.strong ? "text-lg font-semibold" : "text-base",
                item.value < 0 ? "text-pink" : "text-ink",
              )}
            >
              {money(item.value)}
            </dd>
          </div>
        ))}
        <div
          className={cn(
            "rounded-xl border px-3 py-2",
            summary.warning ? "border-pink/60 bg-pink/10" : "border-line bg-surface",
          )}
        >
          <dt className="text-xs text-ink-muted">{t("lowest")}</dt>
          <dd
            data-testid="plan-summary-lowest"
            className={cn("text-base tabular-nums", summary.lowest.value < 0 ? "text-pink" : "text-ink")}
          >
            {money(summary.lowest.value)}
          </dd>
          <dd data-testid="plan-summary-lowest-week" className="text-xs text-ink-soft">
            {lowestWeek
              ? t("lowestWeek", {
                  week: lowestWeek.week,
                  range: `${formatDayMonth(lowestWeek.start, settings)} – ${formatDayMonth(lowestWeek.end, settings)}`,
                })
              : ""}
          </dd>
        </div>
      </dl>
      {summary.warning && (
        <p role="status" className="flex items-start gap-2 rounded-xl bg-pink/10 px-3 py-2 text-sm text-ink">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-pink" />
          {summary.warning === "negative"
            ? t("warningNegative", { week: summary.lowest.week })
            : t("warningReserve", { week: summary.lowest.week, reserve: money(reserve ?? 0) })}
        </p>
      )}
      <ReserveField reserve={reserve} canEdit={canEdit} currency={currency} onSave={onSaveReserve} />
    </aside>
  );
}

function ReserveField({
  reserve,
  canEdit,
  currency,
  onSave,
}: {
  reserve: number | null;
  canEdit: boolean;
  currency: string;
  onSave: (value: number | null) => void;
}) {
  const t = useTranslations("finance.plan.summary");
  const settings = useFormatSettings();
  const decimal = decimalMarkOf(settings.numberLocale);
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const shown = draft ?? (reserve === null ? "" : String(reserve).replace(".", decimal));

  function save() {
    if (draft === null) return;
    const parsed = parseAmountInput(draft, decimal);
    if (!parsed.ok || (parsed.value !== null && parsed.value < 0)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setDraft(null);
    if (parsed.value !== reserve) onSave(parsed.value);
  }

  return (
    <label className="flex flex-col gap-1 text-xs text-ink-muted">
      {t("reserve", { currency })}
      <input
        value={shown}
        disabled={!canEdit}
        inputMode="decimal"
        placeholder={t("reservePlaceholder")}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") save();
          if (event.key === "Escape") setDraft(null);
        }}
        className={cn(
          "h-11 rounded-xl border bg-canvas-deep px-3 text-right text-sm text-violet tabular-nums outline-none focus:border-violet disabled:opacity-60 mouse:h-9",
          invalid ? "border-pink" : "border-line",
        )}
      />
      <span className="text-[11px]">{t("reserveHint")}</span>
    </label>
  );
}
