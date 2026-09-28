"use client";

import { useState, type FormEvent } from "react";
import { Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseAmount } from "@/features/pipeline/schemas";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { cn } from "@/lib/utils";
import {
  AMOUNT_MAX,
  kindsFor,
  NOTE_MAX,
  PERCENT_MAX,
  REWARD_TRIGGERS,
  type RewardBranch,
  type RewardKind,
  type RewardLeaf,
  type RewardTrigger,
} from "./reward-tree";

const ALL_WORKERS = "__all";

type BranchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing this trigger, or adding one when null. */
  branch: RewardBranch | null;
  workers: { id: string; name: string }[];
  onSave: (value: Pick<RewardBranch, "trigger" | "workerId">) => void;
  onDelete: () => void;
};

/** A trigger: what event pays, and for whom. */
export function BranchDialog({ open, onOpenChange, branch, workers, onSave, onDelete }: BranchDialogProps) {
  const t = useTranslations("workers.rewards");
  const generation = useFreshOnOpen(open);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={branch ? t("editTriggerTitle") : t("newTriggerTitle")}
      closeLabel={t("close")}
    >
      <BranchFields
        key={generation}
        branch={branch}
        workers={workers}
        onCancel={() => onOpenChange(false)}
        onSave={(value) => {
          onSave(value);
          onOpenChange(false);
        }}
        onDelete={() => {
          onDelete();
          onOpenChange(false);
        }}
      />
    </ResponsiveDialog>
  );
}

function BranchFields({
  branch,
  workers,
  onCancel,
  onSave,
  onDelete,
}: {
  branch: RewardBranch | null;
  workers: { id: string; name: string }[];
  onCancel: () => void;
  onSave: (value: Pick<RewardBranch, "trigger" | "workerId">) => void;
  onDelete: () => void;
}) {
  const t = useTranslations("workers.rewards");
  const [trigger, setTrigger] = useState<RewardTrigger>(branch?.trigger ?? "task_completed");
  const [workerId, setWorkerId] = useState<string | null>(branch?.workerId ?? null);
  const triggerItems = REWARD_TRIGGERS.map((value) => ({ value, label: t(`trigger.${value}`) }));
  const workerItems = [
    { value: ALL_WORKERS, label: t("scope.all") },
    ...workers.map((worker) => ({ value: worker.id, label: worker.name })),
  ];

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({ trigger, workerId });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <FormField id="reward-trigger" label={t("triggerLabel")} hint={t(`triggerHint.${trigger}`)}>
        <Select
          value={trigger}
          items={triggerItems}
          onValueChange={(next) => next && setTrigger(next as RewardTrigger)}
        >
          <SelectTrigger id="reward-trigger" aria-describedby="reward-trigger-message">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {triggerItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField id="reward-worker" label={t("scopeLabel")}>
        <Select
          value={workerId ?? ALL_WORKERS}
          items={workerItems}
          onValueChange={(next) => setWorkerId(!next || next === ALL_WORKERS ? null : next)}
        >
          <SelectTrigger id="reward-worker">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {workerItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      {branch && branch.leaves.some((leaf) => !kindsFor(trigger).includes(leaf.kind)) && (
        <p className="text-xs text-gold">{t("kindChangeHint")}</p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {branch && (
          <Button type="button" variant="destructive" className="sm:mr-auto" onClick={onDelete}>
            <Trash2Icon aria-hidden data-icon="inline-start" />
            {t("deleteTrigger")}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit">{t("save")}</Button>
      </div>
    </form>
  );
}

type LeafDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: RewardTrigger;
  /** Editing this rule, or adding one when null. */
  leaf: RewardLeaf | null;
  onSave: (value: Omit<RewardLeaf, "id">) => void;
  onDelete: () => void;
};

/** A rule: how much, in what way, and conditions in plain words. */
export function LeafDialog({ open, onOpenChange, trigger, leaf, onSave, onDelete }: LeafDialogProps) {
  const t = useTranslations("workers.rewards");
  const generation = useFreshOnOpen(open);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={leaf ? t("editRuleTitle") : t("newRuleTitle", { trigger: t(`trigger.${trigger}`) })}
      closeLabel={t("close")}
    >
      <LeafFields
        key={generation}
        trigger={trigger}
        leaf={leaf}
        onCancel={() => onOpenChange(false)}
        onSave={(value) => {
          onSave(value);
          onOpenChange(false);
        }}
        onDelete={() => {
          onDelete();
          onOpenChange(false);
        }}
      />
    </ResponsiveDialog>
  );
}

function LeafFields({
  trigger,
  leaf,
  onCancel,
  onSave,
  onDelete,
}: {
  trigger: RewardTrigger;
  leaf: RewardLeaf | null;
  onCancel: () => void;
  onSave: (value: Omit<RewardLeaf, "id">) => void;
  onDelete: () => void;
}) {
  const t = useTranslations("workers.rewards");
  const kinds = kindsFor(trigger);
  const [kind, setKind] = useState<RewardKind>(
    leaf && kinds.includes(leaf.kind) ? leaf.kind : kinds[0],
  );
  const [amount, setAmount] = useState(leaf ? String(leaf.amount) : "");
  const [note, setNote] = useState(leaf?.note ?? "");
  const [error, setError] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = parseAmount(amount);
    const max = kind === "percent" ? PERCENT_MAX : AMOUNT_MAX;
    if (value === null || !Number.isFinite(value) || value <= 0 || value > max) {
      setError(true);
      return;
    }
    onSave({ kind, amount: value, note: note.trim().slice(0, NOTE_MAX) });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {kinds.length > 1 && (
        <div role="radiogroup" aria-label={t("kindLabel")} className="grid grid-cols-2 gap-2">
          {kinds.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={kind === value}
              onClick={() => setKind(value)}
              className={cn(
                "h-11 cursor-pointer rounded-xl border text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-violet/40",
                kind === value
                  ? "border-violet/50 bg-violet/15 text-ink"
                  : "border-line text-ink-soft hover:text-ink",
              )}
            >
              {t(`kind.${value}`)}
            </button>
          ))}
        </div>
      )}
      <FormField
        id="reward-amount"
        label={t(`amountLabel.${kind}`)}
        error={error ? t(kind === "percent" ? "percentInvalid" : "amountInvalid") : undefined}
      >
        <Input
          {...fieldA11y("reward-amount", error)}
          value={amount}
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          onChange={(event) => setAmount(event.target.value)}
        />
      </FormField>
      <FormField id="reward-note" label={t("noteLabel")} hint={t(`noteHint.${trigger}`)}>
        <Textarea
          {...fieldA11y("reward-note", undefined, true)}
          value={note}
          rows={3}
          maxLength={NOTE_MAX}
          onChange={(event) => setNote(event.target.value)}
        />
      </FormField>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {leaf && (
          <Button type="button" variant="destructive" className="sm:mr-auto" onClick={onDelete}>
            <Trash2Icon aria-hidden data-icon="inline-start" />
            {t("deleteRule")}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit">{t("save")}</Button>
      </div>
    </form>
  );
}
