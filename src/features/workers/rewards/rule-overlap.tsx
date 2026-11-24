"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { overlappingPairs } from "./definition";
import { useSetRulesStack } from "./queries";
import { useRuleText, type NameOf } from "./rule-sentence";
import type { RewardRule } from "./types";

/** Two rules on one event: both pay ("add up") or only the highest one. */
export function StackChoice({
  value,
  onChange,
  disabled = false,
}: {
  value: "sum" | "max";
  onChange: (value: "sum" | "max") => void;
  disabled?: boolean;
}) {
  const t = useTranslations("workers.rewardPlan.overlap");
  return (
    <div role="radiogroup" aria-label={t("label")} className="flex flex-wrap gap-2">
      {(["sum", "max"] as const).map((key) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          disabled={disabled}
          data-testid={`reward-stack-${key}`}
          onClick={() => onChange(key)}
          className={cn(
            "min-h-11 cursor-pointer rounded-xl border px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-violet/40 disabled:cursor-default disabled:opacity-60 mouse:min-h-9",
            value === key ? "border-violet/60 bg-violet/15 text-ink" : "border-line text-ink-soft hover:border-line-strong",
          )}
        >
          {t(key)}
        </button>
      ))}
    </div>
  );
}

/** The plan's pairs of active rules that can pay the same event, each with the choice. */
export function OverlapNotes({
  rules,
  currency,
  nameOf,
  canEdit,
}: {
  rules: readonly RewardRule[];
  currency: string;
  nameOf: NameOf;
  canEdit: boolean;
}) {
  const t = useTranslations("workers.rewardPlan.overlap");
  const text = useRuleText();
  const stack = useSetRulesStack();
  const pairs = overlappingPairs(rules);
  if (pairs.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="reward-overlaps">
      {pairs.map(([a, b]) => {
        const value = a.definition.stack === "max" && b.definition.stack === "max" ? "max" : "sum";
        return (
          <div key={`${a.id}-${b.id}`} className="flex flex-col gap-2 rounded-2xl border border-orange/30 bg-orange/10 px-3 py-2.5">
            <p className="text-sm text-ink">{t("title")}</p>
            <ul className="flex flex-col gap-1 text-xs text-ink-soft">
              <li>{text(a.definition, currency, nameOf)}</li>
              <li>{text(b.definition, currency, nameOf)}</li>
            </ul>
            <StackChoice
              value={value}
              disabled={!canEdit || stack.isPending}
              onChange={(next) => stack.mutate({ rules: [a, b], stack: next })}
            />
          </div>
        );
      })}
    </div>
  );
}
