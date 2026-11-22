"use client";

import { useState } from "react";
import { GiftIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { CurrencyPicker } from "@/components/ui/currency-picker";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/features/account/workspace-queries";
import { formatPrice } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useCompanyTree } from "../company/queries";
import { useManagesRewards, useRewardPlans, useSetRewardPrice } from "./queries";
import { useAmountText } from "./rule-wizard";
import { AMOUNT_MAX, defaultTaskPrice } from "./rules";
import type { PricedSource } from "./types";

/** Who a task's reward goes to. */
export type PriceTarget =
  | { kind: "crm_task"; assigneeAccountId: string | null }
  | { kind: "worker_task"; workerId: string }
  /** A milestone task: whoever completes it. */
  | { kind: "task" };

type Current = { amount: number | null; currency: string | null } | null;

/**
 * "Reward for completion" of a task (28.2): offered to whoever manages the
 * rewards of the person it goes to, when that person has a reward plan
 * (milestone tasks: to the owner, when anybody has a plan). A new task gets
 * the plan's task_default amount, which the manager may change or clear. The
 * price is saved after the task (commit), through reward_set_price().
 */
export function useRewardPrice(target: PriceTarget, current: Current) {
  const settings = useFormatSettings();
  const workspace = useWorkspace();
  const manages = useManagesRewards();
  const plans = useRewardPlans();
  const people = useCompanyTree();
  const setPrice = useSetRewardPrice();
  const amountText = useAmountText();

  const recipient =
    target.kind === "worker_task"
      ? target.workerId
      : target.kind === "crm_task" && target.assigneeAccountId
        ? (people.data?.find(
            (person) => person.userId === target.assigneeAccountId && person.status === "active",
          )?.id ?? null)
        : null;
  const plan = recipient ? (plans.data?.get(recipient) ?? null) : null;
  const self = recipient !== null && recipient === workspace.workerId;
  const editable =
    manages &&
    !workspace.readOnly &&
    (target.kind === "task"
      ? workspace.role === "owner" && (plans.data?.size ?? 0) > 0
      : plan !== null && !self);

  const fallback = current?.amount ?? (current ? null : defaultTaskPrice(plan));
  const [text, setText] = useState<string | null>(null);
  const [currencyChoice, setCurrency] = useState<string | null>(null);
  const shown = text ?? amountText.show(fallback);
  const currency = currencyChoice ?? current?.currency ?? plan?.currency ?? settings.currency;
  const parsed = shown.trim() === "" ? null : amountText.parse(shown);
  const invalid = parsed !== null && !(Number.isFinite(parsed) && parsed > 0 && parsed <= AMOUNT_MAX);
  const name = people.data?.find((person) => person.id === recipient)?.name ?? "";

  async function commit(source: PricedSource, id: string) {
    if (!editable || invalid) return;
    const amount = parsed;
    const same =
      amount === (current?.amount ?? null) &&
      (amount === null || currency === (current?.currency ?? null));
    if (same) return;
    await setPrice.mutateAsync({
      source,
      id,
      amount,
      currency,
      fromDefault: text === null && current === null,
    });
  }

  return {
    editable,
    invalid,
    name,
    text: shown,
    setText,
    currency,
    setCurrency,
    commit,
    /** What the person sees on a task with a price, without the right to change it. */
    readOnlyAmount:
      !editable && current?.amount != null && current.currency
        ? formatPrice(current.amount, current.currency, settings)
        : null,
    kind: target.kind,
  };
}

export type RewardPriceState = ReturnType<typeof useRewardPrice>;

/** The field itself; renders nothing for whoever may not see or change it. */
export function RewardPriceField({ state, id }: { state: RewardPriceState; id: string }) {
  const t = useTranslations("workers.rewardPrice");
  if (state.readOnlyAmount) {
    return (
      <p className="flex items-center gap-2 text-sm text-gold" data-testid="task-reward-readonly">
        <GiftIcon aria-hidden className="size-4" />
        {t("readOnly", { amount: state.readOnlyAmount })}
      </p>
    );
  }
  if (!state.editable) return null;
  return (
    <FormField
      id={id}
      label={t("label")}
      hint={state.kind === "task" ? t("hintMilestoneTask") : t("hint", { name: state.name })}
      error={state.invalid ? t("invalid") : undefined}
    >
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={state.text}
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={state.invalid || undefined}
          className="w-40"
          onChange={(event) => state.setText(event.target.value)}
          data-testid="task-reward-amount"
        />
        <CurrencyPicker
          id={`${id}-currency`}
          value={state.currency}
          onChange={state.setCurrency}
          compact
          ariaLabel={t("currency")}
        />
      </div>
    </FormField>
  );
}
