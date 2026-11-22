"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useExchangeRates } from "@/features/currency/use-exchange-rates";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { cn } from "@/lib/utils";
import { useAddTemplateRules, useCreatePlan } from "./queries";
import { RULE_ICON, useRuleSentence } from "./rule-sentence";
import { useAmountText } from "./rule-wizard";
import {
  measureOf,
  REWARD_TEMPLATES,
  ruleErrors,
  RULES_PER_PLAN,
  templateRules,
  type RewardTemplate,
  type RuleInput,
} from "./rules";
import type { RewardPlan } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workerId: string;
  /** The plan the rules are added to; a new plan is made when there is none. */
  plan: Pick<RewardPlan, "id" | "worker_id" | "rules" | "currency"> | null;
  currency: string;
  initial?: RewardTemplate;
};

/**
 * A template in two steps: pick one, see its rules in the plan's currency
 * (amounts are a suggestion, rounded) and change any amount before adding.
 */
export function TemplateDialog(props: Props) {
  const t = useTranslations("workers.rewardPlan.templates");
  const generation = useFreshOnOpen(props.open);
  return (
    <ResponsiveDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t("title")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,560px)]"
    >
      <TemplateBody key={generation} {...props} onDone={() => props.onOpenChange(false)} />
    </ResponsiveDialog>
  );
}

function TemplateBody({
  workerId,
  plan,
  currency,
  initial,
  onDone,
}: Props & { onDone: () => void }) {
  const t = useTranslations("workers.rewardPlan.templates");
  const te = useTranslations("workers.rewardPlan.errors");
  const rates = useExchangeRates();
  const sentence = useRuleSentence();
  const amountText = useAmountText();
  const create = useCreatePlan();
  const add = useAddTemplateRules();
  const [template, setTemplate] = useState<RewardTemplate | null>(initial ?? null);
  const [texts, setTexts] = useState<string[]>(() =>
    initial ? textsOf(templateRules(initial, currency, rates), amountText.show) : [],
  );
  const [failed, setFailed] = useState(false);

  const base = template ? templateRules(template, currency, rates) : [];
  const rules: RuleInput[] = base.map((rule, index) => {
    const measure = measureOf(rule.kind);
    const value = amountText.parse(texts[index] ?? "");
    return {
      ...rule,
      amount: measure === "amount" ? value : null,
      percent: measure === "percent" ? value : null,
    };
  });
  const invalid = rules.some((rule) => Object.keys(ruleErrors(rule)).length > 0);
  const tooMany = (plan?.rules.length ?? 0) + rules.length > RULES_PER_PLAN;

  function choose(next: RewardTemplate) {
    setTemplate(next);
    setTexts(textsOf(templateRules(next, currency, rates), amountText.show));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!template || invalid || tooMany) return;
    setFailed(false);
    try {
      if (plan) await add.mutateAsync({ plan, template, rules });
      else await create.mutateAsync({ workerId, currency, template, rules });
      onDone();
    } catch {
      setFailed(true);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5" data-testid="reward-template-dialog">
      <div className="grid gap-2 sm:grid-cols-2">
        {REWARD_TEMPLATES.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={template === key}
            data-testid={`reward-template-${key}`}
            onClick={() => choose(key)}
            className={cn(
              "flex min-h-14 cursor-pointer flex-col items-start gap-0.5 rounded-2xl border p-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-violet/40",
              template === key ? "border-violet/60 bg-violet/10" : "border-line hover:border-line-strong",
            )}
          >
            <span className="text-sm font-medium text-ink">{t(`${key}.name`)}</span>
            <span className="text-xs text-ink-muted">{t(`${key}.description`)}</span>
          </button>
        ))}
      </div>

      {template && (
        <ul className="flex flex-col gap-3">
          {rules.map((rule, index) => {
            const measure = measureOf(rule.kind);
            const Icon = RULE_ICON[rule.kind];
            const errors = ruleErrors(rule);
            const bad = Boolean(errors.amount ?? errors.percent);
            return (
              <li key={`${rule.kind}-${index}`} className="flex flex-col gap-2 rounded-2xl border border-line p-3">
                <div className="flex items-start gap-3">
                  <Icon aria-hidden className="mt-0.5 size-4.5 shrink-0 text-gold" />
                  <span className="text-sm text-ink">
                    {bad ? t("fillIn") : sentence(rule, currency)}
                  </span>
                </div>
                {measure !== "price" && (
                  <label className="flex items-center gap-2 text-sm text-ink-soft">
                    <span className="min-w-24">
                      {measure === "percent" ? t("percent") : t("amount", { currency })}
                    </span>
                    <Input
                      value={texts[index] ?? ""}
                      inputMode="decimal"
                      autoComplete="off"
                      aria-invalid={bad || undefined}
                      className="w-36"
                      onChange={(event) =>
                        setTexts((current) => current.map((text, i) => (i === index ? event.target.value : text)))
                      }
                    />
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {template && <p className="text-xs text-ink-muted">{t("suggestion")}</p>}
      {tooMany && <FormAlert>{te("tooManyRules")}</FormAlert>}
      {failed && <FormAlert>{t("saveFailed")}</FormAlert>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("cancel")}
        </Button>
        <Button
          type="submit"
          disabled={!template || invalid || tooMany || create.isPending || add.isPending}
          data-testid="reward-template-apply"
        >
          {t("apply")}
        </Button>
      </div>
    </form>
  );
}

function textsOf(rules: RuleInput[], show: (value: number | null) => string): string[] {
  return rules.map((rule) => show(measureOf(rule.kind) === "percent" ? rule.percent : rule.amount));
}
