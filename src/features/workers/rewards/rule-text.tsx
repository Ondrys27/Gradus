"use client";

import { useTranslations } from "next-intl";
import {
  ClockIcon,
  HandshakeIcon,
  ListChecksIcon,
  TrophyIcon,
  type LucideIcon,
} from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import type { CompiledRule, RewardKind, RewardTrigger } from "./reward-tree";

export const TRIGGER_ICON: Record<RewardTrigger, LucideIcon> = {
  task_completed: ListChecksIcon,
  meeting_booked: HandshakeIcon,
  deal_won: TrophyIcon,
  hour_worked: ClockIcon,
};

/** The amount of a rule as it reads on a node: money, a share, or money per hour. */
export function useRuleAmount() {
  const t = useTranslations("workers.rewards");
  const settings = useFormatSettings();
  return (kind: RewardKind, amount: number) => {
    const decimals = Number.isInteger(amount) ? 0 : 2;
    if (kind === "percent") {
      return formatNumber(amount / 100, { style: "percent", decimals: decimals }, settings);
    }
    const money = formatCurrency(amount, undefined, settings, decimals);
    return kind === "hourly" ? t("perHour", { amount: money }) : money;
  };
}

/** One rule in words: amount, trigger, who it is for and its conditions. */
export function RuleText({
  rule,
  workerNames,
}: {
  rule: CompiledRule;
  workerNames: Map<string, string>;
}) {
  const t = useTranslations("workers.rewards");
  const settings = useFormatSettings();
  const amount = useRuleAmount();
  const { trigger, kind, conditions } = rule.rule;
  const Icon = TRIGGER_ICON[trigger];
  const extras = [
    conditions.minDealValue !== undefined &&
      t("condition.minDealValue", {
        value: formatCurrency(conditions.minDealValue, undefined, settings),
      }),
    conditions.onlyBeforeDue && t("condition.onlyBeforeDue"),
    conditions.maxPerMonth !== undefined &&
      t("condition.maxPerMonth", {
        count: conditions.maxPerMonth,
        shown: formatNumber(conditions.maxPerMonth, {}, settings),
      }),
  ].filter((value): value is string => Boolean(value));

  return (
    <div className="flex items-start gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-gold/30 bg-gold/10 text-gold">
        <Icon aria-hidden className="size-4" />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium text-ink">
          {t(`sentence.${trigger}.${kind}`, { amount: amount(kind, rule.rule.amount) })}
        </span>
        <span className="text-xs text-ink-soft">
          {rule.workerId
            ? (workerNames.get(rule.workerId) ?? t("scope.removed"))
            : t("scope.all")}
          {extras.length > 0 && ` · ${extras.join(" · ")}`}
        </span>
      </div>
    </div>
  );
}
