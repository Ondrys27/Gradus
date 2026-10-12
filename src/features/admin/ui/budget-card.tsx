import { getTranslations } from "next-intl/server";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusPill } from "@/components/ui/status-pill";
import type { Tone } from "@/components/ui/tone";
import type { BudgetSnapshot, BudgetStatus } from "@/features/jarvis/budget";
import { formatNumber } from "@/lib/format";
import { ADMIN_FORMAT_SETTINGS } from "../format-metric";
import { AdminCard } from "./blocks";

const STATUS_TONE: Record<BudgetStatus, Tone> = { ok: "green", near: "gold", paused: "pink" };
const BAR_TONE = { ok: "progress", near: "reward", paused: "danger" } as const;

const usd = (value: number) =>
  formatNumber(value, { style: "currency", currency: "USD", decimals: 2 }, ADMIN_FORMAT_SETTINGS);

/** Jarvis's spend this month against the budget, the pace and whether Jarvis is paused. */
export async function BudgetCard({ budget }: { budget: BudgetSnapshot }) {
  const t = await getTranslations("admin.ai.budget");
  const percent = formatNumber(budget.share, { style: "percent" }, ADMIN_FORMAT_SETTINGS);
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
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-2xl font-semibold text-ink tabular-nums">
          {t("spentOf", { spent: usd(budget.spentUsd), budget: usd(budget.budgetUsd) })}
        </p>
        <p className="text-sm font-medium text-ink-soft tabular-nums">{percent}</p>
      </div>
      <ProgressBar
        value={Math.min(budget.share, 1) * 100}
        label={t("meter")}
        tone={BAR_TONE[budget.status]}
      />
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-ink-muted">{t("projected")}</dt>
          <dd className="font-semibold text-ink tabular-nums">{usd(budget.projectedUsd)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-ink-muted">{t("calls")}</dt>
          <dd className="font-semibold text-ink tabular-nums">
            {formatNumber(budget.calls, {}, ADMIN_FORMAT_SETTINGS)}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-ink-muted">{t(`statusHint.${budget.status}`)}</p>
    </AdminCard>
  );
}
