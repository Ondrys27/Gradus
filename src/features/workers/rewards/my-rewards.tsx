"use client";

import { useMemo } from "react";
import { GiftIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { formatDate, formatNumber, formatPrice } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { PayoutHistory } from "./payouts-panel";
import { PlanCard } from "./plan-card";
import { useRewardEntries, useRewardPlan, useRewardTotals } from "./queries";
import { RewardsTiles } from "./rewards-tiles";
import { monthBounds, plannedSummary } from "./summary";
import { STATUS_TONE } from "./work-table";

/**
 * A worker's own rewards, read only: what they earned this month, what waits
 * for approval and for the payout, what is coming ("12 000 Kč for 3 tasks
 * waits for you"), their rules as sentences, the rewards and the payouts.
 */
export function MyRewards({ workerId }: { workerId: string }) {
  const settings = useFormatSettings();
  const plan = useRewardPlan(workerId);
  const totals = useRewardTotals(workerId);
  const currency = plan.data?.currency ?? settings.currency;

  return (
    <div className="flex flex-col gap-5" data-testid="my-rewards" data-tutorial="reward-mine">
      <RewardsTiles totals={totals.data} isError={totals.isError} currency={currency} />
      <Coming workerId={workerId} />
      <PlanCard workerId={workerId} editable={false} readOnly />
      <RecentRewards workerId={workerId} />
      <GlowCard interactive={false} className="flex flex-col gap-3">
        <PayoutHistory workerId={workerId} />
      </GlowCard>
    </div>
  );
}

function useMonthEntries(workerId: string) {
  const settings = useFormatSettings();
  const range = useMemo(() => monthBounds(settings), [settings]);
  return useRewardEntries(workerId, range);
}

/** "12 000 Kč for 3 tasks waits for you", per currency. */
function Coming({ workerId }: { workerId: string }) {
  const t = useTranslations("workers.rewardPlan.mine");
  const settings = useFormatSettings();
  const entries = useMonthEntries(workerId);
  const coming = plannedSummary(entries.data ?? []);
  if (coming.length === 0) return null;
  return (
    <GlowCard interactive={false} className="flex items-start gap-4 border-gold/30" data-testid="reward-coming">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-gold/30 bg-gold/10 text-gold">
        <GiftIcon aria-hidden className="size-5" />
      </span>
      <div className="flex flex-col gap-1">
        {coming.map((item) => (
          <p key={item.currency} className="text-sm text-ink">
            {t("coming", {
              amount: formatPrice(item.amount, item.currency, settings),
              tasks: item.tasks,
              tasksShown: formatNumber(item.tasks, {}, settings),
              other: item.other,
            })}
          </p>
        ))}
      </div>
    </GlowCard>
  );
}

/** This month's rewards and everything still open, newest first. */
function RecentRewards({ workerId }: { workerId: string }) {
  const t = useTranslations("workers.rewardPlan");
  const settings = useFormatSettings();
  const entries = useMonthEntries(workerId);
  return (
    <GlowCard interactive={false} className="flex flex-col gap-3">
      <h3 className="text-base font-semibold text-ink">{t("mine.recent")}</h3>
      {entries.isError ? (
        <FormAlert>{t("work.loadFailed")}</FormAlert>
      ) : !entries.data ? (
        <Skeleton className="h-16 w-full rounded-xl" />
      ) : entries.data.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("mine.empty")}</p>
      ) : (
        <ul className="-mx-2 flex flex-col divide-y divide-line/50">
          {entries.data.slice(0, 50).map((entry) => (
            <li key={entry.id} className="flex items-center gap-3 px-2 py-2.5">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm text-ink">{entry.note || t(`source.${entry.source_kind}`)}</span>
                <span className="text-xs text-ink-muted">
                  {t(`source.${entry.rule_kind === "manual" ? "manual" : entry.source_kind}`)} ·{" "}
                  {formatDate(new Date(entry.occurred_at), settings)}
                </span>
              </div>
              <span className="flex flex-col items-end gap-1">
                <span className="text-sm font-semibold text-ink tabular-nums">
                  {formatPrice(entry.amount, entry.currency, settings)}
                </span>
                <StatusPill tone={STATUS_TONE[entry.status]}>{t(`status.${entry.status}`)}</StatusPill>
              </span>
            </li>
          ))}
        </ul>
      )}
    </GlowCard>
  );
}
