"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toneFill } from "@/components/ui/tone";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { cn } from "@/lib/utils";
import { useCreateStage, useRemoveStage } from "./queries";
import { fieldErrors, STAGE_NAME_MAX, stageSchema, type PipelineErrorKey } from "./schemas";
import { STAGE_TONES, stageTone, type Stage, type StageKind } from "./types";

const KINDS: StageKind[] = ["open", "won", "lost"];

export function AddStageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pipeline.stageDialog");
  const generation = useFreshOnOpen(open);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("addTitle")}
      closeLabel={t("close")}
    >
      <AddStageFields key={generation} onDone={() => onOpenChange(false)} />
    </ResponsiveDialog>
  );
}

function AddStageFields({ onDone }: { onDone: () => void }) {
  const t = useTranslations("pipeline");
  const create = useCreateStage();
  const [name, setName] = useState("");
  const [color, setColor] = useState<(typeof STAGE_TONES)[number]>("violet");
  const [kind, setKind] = useState<StageKind>("open");
  const [errors, setErrors] = useState<Partial<Record<string, PipelineErrorKey>>>({});
  const [failed, setFailed] = useState(false);

  const kinds = useMemo(
    () => KINDS.map((value) => ({ value, label: t(`stageDialog.kinds.${value}`) })),
    [t],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailed(false);
    const parsed = stageSchema.safeParse({ name, color, kind });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    try {
      await create.mutateAsync(parsed.data);
      onDone();
    } catch {
      setFailed(true);
    }
  }

  const nameError = errors.name && t(`errors.${errors.name}`);

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormField id="stage-name" label={t("stageDialog.name")} error={nameError}>
        <Input
          {...fieldA11y("stage-name", nameError)}
          value={name}
          maxLength={STAGE_NAME_MAX + 10}
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
      </FormField>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-ink-soft">{t("stageDialog.color")}</legend>
        <div className="flex flex-wrap gap-2">
          {STAGE_TONES.map((tone) => (
            <button
              key={tone}
              type="button"
              aria-pressed={color === tone}
              aria-label={t(`stageDialog.colors.${tone}`)}
              onClick={() => setColor(tone)}
              className={cn(
                "grid size-11 cursor-pointer place-items-center rounded-full border outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-9",
                color === tone ? "border-ink" : "border-line",
              )}
            >
              <span className={cn("size-5 rounded-full", toneFill[stageTone(tone)])} />
            </button>
          ))}
        </div>
      </fieldset>
      <FormField
        id="stage-kind"
        label={t("stageDialog.kind")}
        hint={t(`stageDialog.kindHint.${kind}`)}
      >
        <Select
          value={kind}
          items={kinds}
          onValueChange={(next) => {
            if (next === "open" || next === "won" || next === "lost") setKind(next);
          }}
        >
          <SelectTrigger id="stage-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {kinds.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      {failed && <FormAlert>{t("stageDialog.saveFailed")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("stageDialog.cancel")}
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {t("stageDialog.add")}
        </Button>
      </div>
    </form>
  );
}

type RemoveProps = {
  /** The stage about to be removed; the dialog is open while there is one. */
  stage: Stage | null;
  stages: Stage[];
  dealCount: number;
  onClose: () => void;
};

/** A stage with deals asks where to move them; the last stage cannot be removed at all. */
export function RemoveStageDialog({ stage, stages, dealCount, onClose }: RemoveProps) {
  const t = useTranslations("pipeline.stageDialog");
  const generation = useFreshOnOpen(stage !== null);
  return (
    <ResponsiveDialog
      open={stage !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("removeTitle")}
      closeLabel={t("close")}
    >
      {stage && (
        <RemoveFields
          key={generation}
          stage={stage}
          others={stages.filter((item) => item.id !== stage.id)}
          dealCount={dealCount}
          onClose={onClose}
        />
      )}
    </ResponsiveDialog>
  );
}

function RemoveFields({
  stage,
  others,
  dealCount,
  onClose,
}: {
  stage: Stage;
  others: Stage[];
  dealCount: number;
  onClose: () => void;
}) {
  const t = useTranslations("pipeline.stageDialog");
  const remove = useRemoveStage();
  const [target, setTarget] = useState(others[0]?.id ?? "");
  const [failed, setFailed] = useState<"last" | "other" | null>(null);
  const items = useMemo(
    () => others.map((item) => ({ value: item.id, label: item.name })),
    [others],
  );
  const lastStage = others.length === 0;

  async function confirm() {
    setFailed(null);
    try {
      await remove.mutateAsync({ id: stage.id, moveTo: dealCount > 0 ? target : null });
      onClose();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : (error as { message?: string })?.message;
      setFailed(message?.includes("last_stage") ? "last" : "other");
    }
  }

  if (lastStage) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">{t("lastStage")}</p>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("cancel")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-soft">
        {dealCount > 0
          ? t("removeWithDeals", { name: stage.name, count: dealCount })
          : t("removeEmpty", { name: stage.name })}
      </p>
      {dealCount > 0 && (
        <FormField id="remove-target" label={t("moveTo")}>
          <Select value={target} items={items} onValueChange={(next) => next && setTarget(next)}>
            <SelectTrigger id="remove-target">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {items.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )}
      {failed && <FormAlert>{failed === "last" ? t("lastStage") : t("removeFailed")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={remove.isPending}
          onClick={() => void confirm()}
        >
          {t("remove")}
        </Button>
      </div>
    </div>
  );
}
