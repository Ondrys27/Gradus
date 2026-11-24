"use client";

import { useState, type FormEvent } from "react";
import { GiftIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { CurrencyPicker } from "@/components/ui/currency-picker";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/features/account/workspace-queries";
import { formatPrice } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useCompanyTree } from "../company/queries";
import { useManagesRewards, useRewardPlans, useSetRewardPrice } from "./queries";
import { useAmountText } from "./amount-text";
import { AMOUNT_MAX } from "./rules";

type Props = {
  amount: number | null;
  currency: string | null;
} & (
  | {
      kind: "deal";
      dealId: string;
      /** Accounts on the deal and whoever made it: they are paid by it, so never price it. */
      people: string[];
    }
  | { kind: "milestone"; milestoneId: string; workerId: string | null }
);

const NOBODY = "none";

/**
 * The optional fixed reward of a deal (when won, for every worker with a plan
 * on it) or of a milestone (when finished, for the worker whose project it
 * is). Whoever manages rewards sets it while somebody in the company has a
 * plan; the rest only see it once it is set.
 */
export function CompletionReward(props: Props) {
  const t = useTranslations("workers.rewardPrice");
  const tPlan = useTranslations("workers.rewardPlan");
  const settings = useFormatSettings();
  const workspace = useWorkspace();
  const manages = useManagesRewards();
  const plans = useRewardPlans();
  const people = useCompanyTree();
  const setPrice = useSetRewardPrice();
  const amountText = useAmountText();
  const [text, setText] = useState(amountText.show(props.amount));
  const [currency, setCurrency] = useState(props.currency ?? settings.currency);
  const [worker, setWorker] = useState(props.kind === "milestone" ? (props.workerId ?? NOBODY) : NOBODY);
  const [saved, setSaved] = useState(false);

  const onIt = props.kind === "deal" && props.people.includes(workspace.userId);
  const editable =
    manages &&
    !workspace.readOnly &&
    (plans.data?.size ?? 0) > 0 &&
    (workspace.role === "owner" || !onIt);

  if (!editable) {
    if (props.amount === null || !props.currency) return null;
    return (
      <p className="flex items-center gap-2 text-sm text-gold" data-testid="completion-reward-readonly">
        <GiftIcon aria-hidden className="size-4" />
        {props.kind === "deal" ? t("dealLabel") : t("milestoneLabel")}:{" "}
        {formatPrice(props.amount, props.currency, settings)}
      </p>
    );
  }

  const parsed = text.trim() === "" ? null : amountText.parse(text);
  const invalid = parsed !== null && !(Number.isFinite(parsed) && parsed > 0 && parsed <= AMOUNT_MAX);
  // Only people with a plan can be paid; the current one stays offered.
  const withPlan = (people.data ?? []).filter(
    (person) =>
      person.status === "active" &&
      (plans.data?.has(person.id) || (props.kind === "milestone" && person.id === props.workerId)) &&
      person.id !== workspace.workerId,
  );
  const items = [
    { value: NOBODY, label: t("milestoneNobody") },
    ...withPlan.map((person) => ({ value: person.id, label: person.name })),
  ];

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (invalid) return;
    setSaved(false);
    await setPrice.mutateAsync(
      props.kind === "deal"
        ? { source: "deal", id: props.dealId, amount: parsed, currency }
        : {
            source: "milestone",
            id: props.milestoneId,
            amount: parsed,
            currency,
            workerId: worker === NOBODY ? null : worker,
          },
    );
    setSaved(true);
  }

  return (
    <form onSubmit={(event) => void submit(event).catch(() => undefined)} className="flex flex-col gap-2" data-testid="completion-reward">
      <span className="text-sm font-medium text-ink-soft">
        {props.kind === "deal" ? t("dealLabel") : t("milestoneLabel")}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {props.kind === "milestone" && (
          <Select value={worker} items={items} onValueChange={(next) => typeof next === "string" && setWorker(next)}>
            <SelectTrigger aria-label={t("milestoneWorker")} className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Input
          value={text}
          inputMode="decimal"
          autoComplete="off"
          aria-label={props.kind === "deal" ? t("dealLabel") : t("milestoneLabel")}
          aria-invalid={invalid || undefined}
          className="w-32"
          onChange={(event) => {
            setText(event.target.value);
            setSaved(false);
          }}
        />
        <CurrencyPicker id={`completion-reward-${props.kind}`} value={currency} onChange={setCurrency} compact ariaLabel={t("currency")} />
        <Button type="submit" size="sm" variant="outline" disabled={invalid || setPrice.isPending}>
          {saved ? t("saved") : t("save")}
        </Button>
      </div>
      <p className="text-xs text-ink-muted">{props.kind === "deal" ? t("dealHint") : t("milestoneHint")}</p>
      {invalid && <FormAlert>{t("invalid")}</FormAlert>}
      {setPrice.isError && <FormAlert>{tPlan("saveFailed")}</FormAlert>}
    </form>
  );
}
