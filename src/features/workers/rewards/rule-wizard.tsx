"use client";

import { useState, type FormEvent } from "react";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { decimalMarkOf, parseAmountInput } from "@/features/finance/plan/amount-input";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { useSaveRule } from "./queries";
import { RULE_ICON, useRuleSentence } from "./rule-sentence";
import { limitsOf, measureOf, ruleErrors, RULE_GROUPS, type RuleInput } from "./rules";
import type { RewardPlan, RewardRule, RuleKind } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: Pick<RewardPlan, "id" | "worker_id" | "rules" | "currency">;
  /** Editing this rule; a new one when null. */
  rule: RewardRule | null;
};

const STEPS = ["what", "amount", "limits"] as const;
type Step = (typeof STEPS)[number];

/** A rule in three steps: for what → how much → limits, with the sentence it makes. */
export function RuleWizard({ open, onOpenChange, plan, rule }: Props) {
  const t = useTranslations("workers.rewardPlan.wizard");
  const generation = useFreshOnOpen(open);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={rule ? t("editTitle") : t("newTitle")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,560px)]"
    >
      <WizardBody key={generation} plan={plan} rule={rule} onDone={() => onOpenChange(false)} />
    </ResponsiveDialog>
  );
}

/** "1 500,50" in the user's number format; empty = nothing typed. */
function useAmountText() {
  const settings = useFormatSettings();
  const mark = decimalMarkOf(settings.numberLocale);
  return {
    parse: (text: string): number | null => {
      const parsed = parseAmountInput(text, mark);
      return parsed.ok ? parsed.value : Number.NaN;
    },
    show: (value: number | null | undefined) =>
      value === null || value === undefined ? "" : String(value).replace(".", mark),
  };
}

function WizardBody({
  plan,
  rule,
  onDone,
}: {
  plan: Props["plan"];
  rule: RewardRule | null;
  onDone: () => void;
}) {
  const t = useTranslations("workers.rewardPlan");
  const tw = useTranslations("workers.rewardPlan.wizard");
  const sentence = useRuleSentence();
  const amountText = useAmountText();
  const save = useSaveRule();
  const [step, setStep] = useState<Step>(rule ? "amount" : "what");
  const [kind, setKind] = useState<RuleKind>(rule?.kind ?? "task_default");
  const [amount, setAmount] = useState(amountText.show(rule?.amount));
  const [percent, setPercent] = useState(amountText.show(rule?.percent));
  const [cap, setCap] = useState(amountText.show(rule?.cap_per_period));
  const [minDeal, setMinDeal] = useState(amountText.show(rule?.filter.minDealValue));
  const [onTime, setOnTime] = useState(Boolean(rule?.filter.onTimeOnly));
  const [failed, setFailed] = useState(false);

  const input: RuleInput = {
    kind,
    amount: amountText.parse(amount),
    percent: amountText.parse(percent),
    filter: {
      onTimeOnly: onTime,
      ...(minDeal.trim() ? { minDealValue: amountText.parse(minDeal) ?? undefined } : {}),
    },
    cap_per_period: amountText.parse(cap),
  };
  const errors = ruleErrors(input);
  const measure = measureOf(kind);
  const limits = limitsOf(kind);
  const amountInvalid = measure === "amount" ? errors.amount : measure === "percent" ? errors.percent : undefined;
  const limitsInvalid = errors.cap_per_period ?? errors.minDeal;
  const index = STEPS.indexOf(step);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (step === "what") return setStep("amount");
    if (step === "amount") {
      if (!amountInvalid) setStep("limits");
      return;
    }
    if (amountInvalid || limitsInvalid) return;
    setFailed(false);
    try {
      await save.mutateAsync({ plan, ruleId: rule?.id ?? null, rule: input, active: rule?.active ?? true });
      onDone();
    } catch {
      setFailed(true);
    }
  }

  const preview = amountInvalid
    ? null
    : sentence(
        {
          kind,
          amount: input.amount,
          percent: input.percent,
          filter: limitsInvalid ? {} : { ...(onTime ? { onTimeOnly: true } : {}), ...(input.filter.minDealValue ? { minDealValue: input.filter.minDealValue } : {}) },
          cap_per_period: limitsInvalid ? null : input.cap_per_period,
        },
        plan.currency,
      );

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5" data-testid="reward-rule-wizard">
      <ol className="flex items-center gap-2 text-xs" aria-label={tw("steps")}>
        {STEPS.map((key, position) => (
          <li
            key={key}
            aria-current={key === step ? "step" : undefined}
            className={cn(
              "flex items-center gap-2",
              position <= index ? "text-ink" : "text-ink-muted",
            )}
          >
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full border text-[11px] font-semibold",
                position < index && "border-teal/50 bg-teal/15 text-teal",
                position === index && "border-violet/60 bg-violet/15 text-ink",
                position > index && "border-line",
              )}
            >
              {position + 1}
            </span>
            {tw(`step.${key}`)}
            {position < STEPS.length - 1 && <span aria-hidden className="h-px w-4 bg-line" />}
          </li>
        ))}
      </ol>

      {step === "what" && (
        <div className="flex flex-col gap-4">
          {RULE_GROUPS.map((group) => (
            <fieldset key={group.key} className="flex flex-col gap-2">
              <legend className="micro-label mb-1">{tw(`group.${group.key}`)}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {group.kinds.map((option) => {
                  const Icon = RULE_ICON[option];
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={kind === option}
                      data-testid={`reward-kind-${option}`}
                      onClick={() => setKind(option)}
                      className={cn(
                        "flex min-h-14 cursor-pointer items-start gap-3 rounded-2xl border p-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-violet/40",
                        kind === option
                          ? "border-violet/60 bg-violet/10"
                          : "border-line hover:border-line-strong",
                      )}
                    >
                      <Icon aria-hidden className="mt-0.5 size-4.5 shrink-0 text-gold" />
                      <span className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium text-ink">{t(`kind.${option}`)}</span>
                        <span className="text-xs text-ink-muted">{t(`kindHint.${option}`)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      )}

      {step === "amount" && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-soft">{t(`kindHint.${kind}`)}</p>
          {measure === "price" && <p className="text-sm text-ink">{tw("priceExplained")}</p>}
          {measure === "amount" && (
            <FormField
              id="reward-rule-amount"
              label={tw(`amountLabel.${kind === "hourly" ? "hourly" : kind === "monthly_fixed" ? "monthly" : "item"}`, { currency: plan.currency })}
              error={amountInvalid && amount ? t(`errors.${amountInvalid}`) : undefined}
            >
              <Input
                {...fieldA11y("reward-rule-amount", amountInvalid && amount ? "x" : undefined)}
                value={amount}
                inputMode="decimal"
                autoComplete="off"
                autoFocus
                onChange={(event) => setAmount(event.target.value)}
                data-testid="reward-rule-amount"
              />
            </FormField>
          )}
          {measure === "percent" && (
            <FormField
              id="reward-rule-percent"
              label={tw("percentLabel")}
              error={amountInvalid && percent ? t(`errors.${amountInvalid}`) : undefined}
            >
              <Input
                {...fieldA11y("reward-rule-percent", amountInvalid && percent ? "x" : undefined)}
                value={percent}
                inputMode="decimal"
                autoComplete="off"
                autoFocus
                onChange={(event) => setPercent(event.target.value)}
                data-testid="reward-rule-percent"
              />
            </FormField>
          )}
        </div>
      )}

      {step === "limits" && (
        <div className="flex flex-col gap-4">
          {limits.cap && (
            <FormField
              id="reward-rule-cap"
              label={tw("capLabel", { currency: plan.currency })}
              hint={tw("capHint")}
              error={errors.cap_per_period ? t(`errors.${errors.cap_per_period}`) : undefined}
            >
              <Input
                {...fieldA11y("reward-rule-cap", errors.cap_per_period)}
                value={cap}
                inputMode="decimal"
                autoComplete="off"
                onChange={(event) => setCap(event.target.value)}
              />
            </FormField>
          )}
          {limits.minDeal && (
            <FormField
              id="reward-rule-min"
              label={tw("minDealLabel", { currency: plan.currency })}
              hint={tw("minDealHint")}
              error={errors.minDeal ? t(`errors.${errors.minDeal}`) : undefined}
            >
              <Input
                {...fieldA11y("reward-rule-min", errors.minDeal)}
                value={minDeal}
                inputMode="decimal"
                autoComplete="off"
                onChange={(event) => setMinDeal(event.target.value)}
              />
            </FormField>
          )}
          {limits.onTime && (
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
              <Checkbox checked={onTime} onCheckedChange={(checked) => setOnTime(checked === true)} />
              {tw("onTimeLabel")}
            </label>
          )}
          {!limits.cap && !limits.minDeal && !limits.onTime && (
            <p className="text-sm text-ink-soft">{tw("noLimits")}</p>
          )}
        </div>
      )}

      {preview && step !== "what" && (
        <p className="rounded-2xl border border-gold/30 bg-gold/10 px-4 py-3 text-sm text-ink" data-testid="reward-rule-preview">
          {preview}
        </p>
      )}
      {failed && <FormAlert>{tw("saveFailed")}</FormAlert>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          onClick={() => (index === 0 ? onDone() : setStep(STEPS[index - 1]!))}
        >
          {index > 0 && <ArrowLeftIcon aria-hidden data-icon="inline-start" />}
          {index === 0 ? tw("cancel") : tw("back")}
        </Button>
        <Button
          type="submit"
          disabled={save.isPending || (step === "amount" && Boolean(amountInvalid)) || (step === "limits" && Boolean(amountInvalid || limitsInvalid))}
          data-testid="reward-rule-next"
        >
          {step === "limits" ? (rule ? tw("save") : tw("add")) : tw("next")}
          {step !== "limits" && <ArrowRightIcon aria-hidden data-icon="inline-end" />}
        </Button>
      </div>
    </form>
  );
}

export { useAmountText };
