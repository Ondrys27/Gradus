"use client";

import {
  BriefcaseIcon,
  CalendarCheckIcon,
  CalendarClockIcon,
  ClockIcon,
  ListChecksIcon,
  PercentIcon,
  PhoneIcon,
  TagIcon,
  TrophyIcon,
  UserCheckIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { formatNumber, formatPrice } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { sentenceOf } from "./rules";
import type { RewardRule, RuleKind } from "./types";

export const RULE_ICON: Record<RuleKind, LucideIcon> = {
  task_fixed: TagIcon,
  task_default: ListChecksIcon,
  project_done: BriefcaseIcon,
  per_meeting: CalendarCheckIcon,
  per_call: PhoneIcon,
  per_contact: UserCheckIcon,
  deal_percent: PercentIcon,
  deal_fixed: TrophyIcon,
  hourly: ClockIcon,
  monthly_fixed: CalendarClockIcon,
};

export type SentenceRule = Pick<RewardRule, "kind" | "amount" | "percent" | "filter" | "cap_per_period">;

/** A rule as a sentence: "5 % from won deals, at most 30 000 Kč a month". */
export function useRuleSentence() {
  const t = useTranslations("workers.rewardPlan");
  const settings = useFormatSettings();
  return (rule: SentenceRule, currency: string): string => {
    const sentence = sentenceOf(rule);
    const money = (value: number) => formatPrice(value, currency, settings);
    const main = t(`sentence.${sentence.key}`, {
      amount: sentence.amount === null ? "" : money(sentence.amount),
      percent:
        sentence.percent === null
          ? ""
          : formatNumber(sentence.percent / 100, {
              style: "percent",
              decimals: Number.isInteger(sentence.percent) ? 0 : 2,
            }, settings),
    });
    const limits = sentence.limits.map((limit) =>
      limit.key === "onTimeOnly"
        ? t("limit.onTimeOnly")
        : t(`limit.${limit.key}`, { amount: money(limit.value) }),
    );
    return [main, ...limits].join(", ");
  };
}

/** One rule with its icon, for the plan, the worker's page and the invite. */
export function RuleSentence({
  rule,
  currency,
  muted = false,
  className,
}: {
  rule: SentenceRule;
  currency: string;
  /** A rule switched off. */
  muted?: boolean;
  className?: string;
}) {
  const sentence = useRuleSentence();
  const Icon = RULE_ICON[rule.kind];
  return (
    <div className={cn("flex min-w-0 items-start gap-3", muted && "opacity-55", className)}>
      <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-gold/30 bg-gold/10 text-gold">
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="min-w-0 pt-1.5 text-sm text-ink">{sentence(rule, currency)}</span>
    </div>
  );
}
