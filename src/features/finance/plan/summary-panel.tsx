"use client";

import { useState } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatCurrency, formatDayMonth } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { decimalMarkOf, parseAmountInput } from "./amount-input";
import { CapitalSparkline } from "./capital-sparkline";
import type { Sheet } from "./sheet";
import type { PlanWeek } from "./weeks";

type Props = {
  sheet: Sheet;
  weeks: PlanWeek[];
  currentWeek: number | null;
  currency: string;
  reserve: number | null;
  canEdit: boolean;
  onSaveReserve: (value: number | null) => void;
};

/**
 * Shrnutí měsíce: one calm panel right of the table (above it on phones).
 * The closing capital is the headline, under it the capital week by week
 * as a small line, then the other numbers in one two-column list. Below
 * zero or below the reserve it warns and names the week.
 */
export function SummaryPanel({ sheet, weeks, currentWeek, currency, reserve, canEdit, onSaveReserve }: Props) {
  const t = useTranslations("finance.plan.summary");
  const settings = useFormatSettings();
  const { summary } = sheet;
  const money = (value: number) =>
    formatCurrency(value, currency, settings, Number.isInteger(value) ? 0 : 2);
  const lowestWeek = weeks[summary.lowest.week - 1];
  const rows = [
    { key: "opening", value: summary.opening },
    { key: "income", value: summary.income },
    { key: "expense", value: summary.expense },
    { key: "balance", value: summary.balance, divider: true },
  ] as const;

  return (
    <aside
      aria-label={t("title")}
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4"
      data-testid="finance-plan-summary"
    >
      <div>
        <h2 className="text-xs font-medium text-ink-muted">{t("closing")}</h2>
        <p
          data-testid="plan-summary-closing"
          className={cn(
            "mt-1 text-[32px] leading-none font-bold tracking-tight whitespace-nowrap proportional-nums",
            summary.closing < 0 ? "text-pink" : "text-ink",
          )}
        >
          {money(summary.closing)}
        </p>
        <p className="mt-1 text-xs text-ink-muted">{t("closingHint")}</p>
      </div>

      <CapitalSparkline
        values={sheet.closing.weeks}
        currency={currency}
        currentWeek={currentWeek}
        lowestWeek={summary.lowest.week}
        warning={summary.warning !== null}
        reserve={reserve}
      />

      <dl className="flex flex-col text-sm">
        {rows.map((row) => (
          <div
            key={row.key}
            className={cn(
              "flex items-baseline justify-between gap-3 py-1.5",
              "divider" in row && row.divider && "border-t border-line-strong font-medium",
            )}
          >
            <dt className="text-ink-soft">{t(row.key)}</dt>
            <dd
              data-testid={`plan-summary-${row.key}`}
              className={cn("whitespace-nowrap tabular-nums", row.value < 0 ? "text-pink" : "text-ink")}
            >
              {money(row.value)}
            </dd>
          </div>
        ))}
        <div
          className={cn(
            "mt-1 flex items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 -mx-2",
            summary.warning && "bg-pink/10",
          )}
        >
          <dt className="text-ink-soft">
            {t("lowest")}
            <span data-testid="plan-summary-lowest-week" className="block text-xs text-ink-muted">
              {lowestWeek
                ? t("lowestWeek", {
                    week: lowestWeek.week,
                    range: `${formatDayMonth(lowestWeek.start, settings)} – ${formatDayMonth(lowestWeek.end, settings)}`,
                  })
                : ""}
            </span>
          </dt>
          <dd
            data-testid="plan-summary-lowest"
            className={cn(
              "whitespace-nowrap tabular-nums",
              summary.warning ? "font-semibold text-pink" : summary.lowest.value < 0 ? "text-pink" : "text-ink",
            )}
          >
            {money(summary.lowest.value)}
          </dd>
        </div>
      </dl>

      {summary.warning && (
        <p role="status" className="flex items-start gap-2 text-sm text-ink-soft">
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
    <label className="flex flex-col gap-1 border-t border-line pt-3 text-xs text-ink-muted">
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
