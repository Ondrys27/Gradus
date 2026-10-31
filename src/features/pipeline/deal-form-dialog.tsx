"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { useFormatSettings } from "@/lib/use-format-settings";
import { defaultCurrency, emptyDraft, validateDraft, type DealDraft } from "./deal-draft";
import { DealFormFields } from "./deal-form-fields";
import { useCreateDeal, type DealSource } from "./queries";
import type { PipelineErrorKey } from "./schemas";
import type { Deal, DealContact, Stage } from "./types";

/** What a new deal starts with when it is made from somewhere (a contact, Cold Calling). */
export type DealFormInitial = {
  title?: string;
  contact?: DealContact | null;
  /** Null: whoever makes it looks after it. */
  assigneeId?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stages: Stage[];
  /** The stage preselected: the column whose plus was pressed, else the first one. */
  stageId: string | null;
  onCreated: (deal: Deal, stage: Stage) => void;
  initial?: DealFormInitial;
  /** Shows who looks after the deal (prefilled from `initial.assigneeId`). */
  showAssignee?: boolean;
  source?: DealSource;
};

export function DealFormDialog({
  open,
  onOpenChange,
  stages,
  stageId,
  onCreated,
  initial,
  showAssignee,
  source,
}: Props) {
  const t = useTranslations("pipeline.form");
  const generation = useFreshOnOpen(open);

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("createTitle")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,520px)]"
    >
      <NewDealForm
        key={generation}
        stages={stages}
        stageId={stageId}
        initial={initial}
        showAssignee={showAssignee}
        source={source}
        onCancel={() => onOpenChange(false)}
        onCreated={(deal, stage) => {
          onOpenChange(false);
          if (stage) onCreated(deal, stage);
        }}
      />
    </ResponsiveDialog>
  );
}

/**
 * The form of a new deal, also used inside another dialog (moving a contact in
 * Cold Calling). `afterCreate` runs before `onCreated`, while the button still
 * says it is saving; its failure does not undo the deal.
 */
export function NewDealForm({
  stages,
  stageId,
  initial,
  showAssignee = false,
  source = "pipeline",
  afterCreate,
  onCancel,
  onCreated,
  cancelLabel,
}: {
  stages: Stage[];
  stageId: string | null;
  initial?: DealFormInitial;
  showAssignee?: boolean;
  source?: DealSource;
  afterCreate?: (deal: Deal) => Promise<unknown>;
  onCancel: () => void;
  onCreated: (deal: Deal, stage: Stage | undefined) => void;
  cancelLabel?: string;
}) {
  const t = useTranslations("pipeline.form");
  const settings = useFormatSettings();
  const create = useCreateDeal();
  const [draft, setDraft] = useState<DealDraft>(() => ({
    ...emptyDraft(stageId ?? stages[0]?.id ?? "", defaultCurrency(settings.currency)),
    title: initial?.title ?? "",
    contact: initial?.contact ?? null,
    assigneeId: initial?.assigneeId ?? null,
  }));
  const [errors, setErrors] = useState<Partial<Record<string, PipelineErrorKey>>>({});
  const [failed, setFailed] = useState(false);
  const [finishing, setFinishing] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailed(false);
    const result = validateDraft(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    let deal: Deal;
    try {
      deal = await create.mutateAsync({ ...result.data, source });
    } catch {
      setFailed(true);
      return;
    }
    if (afterCreate) {
      setFinishing(true);
      await afterCreate(deal).catch(() => undefined);
      setFinishing(false);
    }
    onCreated(
      deal,
      stages.find((item) => item.id === deal.stage_id),
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <DealFormFields
        idPrefix="new-deal"
        draft={draft}
        errors={errors}
        stages={stages}
        showAssignee={showAssignee}
        onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
      />
      {failed && <FormAlert>{t("saveFailed")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {cancelLabel ?? t("cancel")}
        </Button>
        <Button type="submit" disabled={create.isPending || finishing}>
          {t("create")}
        </Button>
      </div>
    </form>
  );
}
