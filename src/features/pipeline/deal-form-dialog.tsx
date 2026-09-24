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
import { useCreateDeal } from "./queries";
import type { PipelineErrorKey } from "./schemas";
import type { Deal, Stage } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stages: Stage[];
  /** The stage preselected: the column whose plus was pressed, else the first one. */
  stageId: string | null;
  onCreated: (deal: Deal, stage: Stage) => void;
};

export function DealFormDialog({ open, onOpenChange, stages, stageId, onCreated }: Props) {
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
      <CreateFields
        key={generation}
        stages={stages}
        stageId={stageId}
        onDone={() => onOpenChange(false)}
        onCreated={onCreated}
      />
    </ResponsiveDialog>
  );
}

function CreateFields({
  stages,
  stageId,
  onDone,
  onCreated,
}: {
  stages: Stage[];
  stageId: string | null;
  onDone: () => void;
  onCreated: (deal: Deal, stage: Stage) => void;
}) {
  const t = useTranslations("pipeline.form");
  const settings = useFormatSettings();
  const create = useCreateDeal();
  const [draft, setDraft] = useState<DealDraft>(() =>
    emptyDraft(stageId ?? stages[0]?.id ?? "", defaultCurrency(settings.currency)),
  );
  const [errors, setErrors] = useState<Partial<Record<string, PipelineErrorKey>>>({});
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailed(false);
    const result = validateDraft(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    try {
      const deal = await create.mutateAsync(result.data);
      const stage = stages.find((item) => item.id === deal.stage_id);
      onDone();
      if (stage) onCreated(deal, stage);
    } catch {
      setFailed(true);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <DealFormFields
        idPrefix="new-deal"
        draft={draft}
        errors={errors}
        stages={stages}
        onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
      />
      {failed && <FormAlert>{t("saveFailed")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {t("create")}
        </Button>
      </div>
    </form>
  );
}
