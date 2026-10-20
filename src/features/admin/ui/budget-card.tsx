import { getTranslations } from "next-intl/server";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusPill } from "@/components/ui/status-pill";
import type { Tone } from "@/components/ui/tone";
import type { BudgetSnapshot, BudgetStatus } from "@/features/jarvis/budget";
import { formatNumber, formatUsd } from "@/lib/format";
import { describePeriod, periodFigures, type BudgetPeriod } from "../ai-budget-period";
import { ADMIN_FORMAT_SETTINGS } from "../format-metric";
import type { PeriodSpend } from "../server/ai-caps-data";
import { AdminCard } from "./blocks";

const STATUS_TONE: Record<BudgetStatus, Tone> = { ok: "green", near: "gold", paused: "pink" };
const BAR_TONE = { ok: "progress", near: "reward", paused: "danger" } as const;

const usd = (value: number) => formatUsd(value, ADMIN_FORMAT_SETTINGS);

/**
 * Jarvis's spend in the period of the top bar against the monthly cap scaled
 * to it, the monthly cap as the anchor, this month's pace and whether Jarvis
 * is paused right now (the status is always the calendar month the check counts).
 */
export async function BudgetCard({
  budget,
  period,
  spend,
}: {
  /** This calendar month, as the check before a model call counts it. */
  budget: BudgetSnapshot;
  period: BudgetPeriod;
  /** The period's spend; null for the calendar month. */
  spend: PeriodSpend | null;
}) {
  const [t, tPeriod] = await Promise.all([
    getTranslations("admin.ai.budget"),
    getTranslations("admin.ai.period"),
  ]);
  const shown = periodFigures(period, budget, spend);
  const percent = formatNumber(shown.share, { style: "percent" }, ADMIN_FORMAT_SETTINGS);
  return (
    <AdminCard
      title={t("title")}
      description={t("description")}
      actions={
        <StatusPill tone={STATUS_TONE[budget.status]} dot>
          {t(`status.${budget.status}`)}
        </StatusPill>
      }
    >
      <div className="flex flex-col gap-1" data-testid="ai-budget-card">
        <p className="text-lg font-semibold text-ink tabular-nums sm:text-xl">
          {t("headline", {
            period: describePeriod(period, tPeriod, ADMIN_FORMAT_SETTINGS),
            spent: usd(shown.spentUsd),
            capName: t(`capOf.${period.capKind}`),
            cap: usd(shown.capUsd),
          })}
        </p>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {period.kind !== "month" ? (
            <p className="text-sm text-ink-soft tabular-nums">
              {t("anchor", { cap: usd(budget.budgetUsd) })}
            </p>
          ) : (
            <span />
          )}
          <p className="text-sm font-medium text-ink-soft tabular-nums">{percent}</p>
        </div>
      </div>
      <ProgressBar
        value={Math.min(shown.share, 1) * 100}
        label={t("meter")}
        tone={BAR_TONE[shown.status]}
      />
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-ink-muted">{t("projected")}</dt>
          <dd className="font-semibold text-ink tabular-nums">{usd(budget.projectedUsd)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-ink-muted">
            {t("calls", { period: describePeriod(period, tPeriod, ADMIN_FORMAT_SETTINGS) })}
          </dt>
          <dd className="font-semibold text-ink tabular-nums">
            {formatNumber(shown.calls, {}, ADMIN_FORMAT_SETTINGS)}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-ink-muted">{t(`statusHint.${budget.status}`)}</p>
    </AdminCard>
  );
}
