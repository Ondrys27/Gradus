"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { HistoryIcon, Trash2Icon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { FormField } from "@/components/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useIsPhone } from "@/lib/use-media-query";
import { draftFromDeal, validateDraft, type DealDraft } from "./deal-draft";
import { DealFormFields } from "./deal-form-fields";
import { useDeleteDeal, useUpdateDeal } from "./queries";
import type { PipelineErrorKey } from "./schemas";
import type { Deal, Stage } from "./types";

type Props = {
  deal: Deal | null;
  stages: Stage[];
  onClose: () => void;
  onRequestMove: (deal: Deal, stage: Stage) => void;
};

/** A side panel on larger screens, a bottom sheet on phones. */
export function DealDetail({ deal, stages, onClose, onRequestMove }: Props) {
  const t = useTranslations("pipeline.detail");
  const isPhone = useIsPhone();

  // Keep the last deal on screen while the panel slides out.
  const [shown, setShown] = useState<Deal | null>(deal);
  if (deal && deal !== shown) setShown(deal);
  const current = deal ?? shown;

  const content = current && (
    <DetailBody
      // The form starts over when the deal changes or crosses in or out of the lost stage.
      key={`${current.id}:${current.lost_at ?? ""}`}
      deal={current}
      stages={stages}
      onClose={onClose}
      onRequestMove={onRequestMove}
    />
  );
  const onOpenChange = (open: boolean) => {
    if (!open) onClose();
  };

  if (isPhone) {
    return (
      <BottomSheet
        open={deal !== null}
        onOpenChange={onOpenChange}
        title={t("title")}
        closeLabel={t("close")}
      >
        {content}
      </BottomSheet>
    );
  }

  return (
    <Dialog.Root open={deal !== null} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-canvas/60 backdrop-blur-sm transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed inset-y-0 right-0 z-50 flex w-[min(100vw,440px)] flex-col overflow-y-auto border-l border-line-strong bg-surface p-6 shadow-popover outline-none transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:translate-x-full data-starting-style:translate-x-full motion-reduce:transition-none">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold text-ink">{t("title")}</Dialog.Title>
            <Dialog.Close
              aria-label={t("close")}
              className="-mr-2 grid size-10 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <XIcon aria-hidden className="size-5" />
            </Dialog.Close>
          </div>
          {content}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DetailBody({
  deal,
  stages,
  onClose,
  onRequestMove,
}: {
  deal: Deal;
  stages: Stage[];
  onClose: () => void;
  onRequestMove: (deal: Deal, stage: Stage) => void;
}) {
  const t = useTranslations("pipeline.detail");
  const settings = useFormatSettings();
  const update = useUpdateDeal(deal.id);
  const remove = useDeleteDeal();
  const [draft, setDraft] = useState<DealDraft>(() => draftFromDeal(deal));
  const [errors, setErrors] = useState<Partial<Record<string, PipelineErrorKey>>>({});
  const [status, setStatus] = useState<"idle" | "saved" | "failed">("idle");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const stage = stages.find((item) => item.id === deal.stage_id);
  const stageItems = useMemo(
    () => stages.map((item) => ({ value: item.id, label: item.name })),
    [stages],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setStatus("idle");
    const result = validateDraft(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    try {
      await update.mutateAsync(result.data);
      setStatus("saved");
    } catch {
      setStatus("failed");
    }
  }

  async function confirmDelete() {
    try {
      await remove.mutateAsync(deal.id);
      setConfirmingDelete(false);
      onClose();
    } catch {
      /* the dialog shows the error */
    }
  }

  const since = t("since", { date: formatDate(new Date(deal.entered_stage_at), settings) });

  return (
    <div className="flex flex-col gap-5">
      <FormField id="deal-stage" label={t("stage")} hint={since}>
        <Select
          value={deal.stage_id}
          items={stageItems}
          onValueChange={(next) => {
            const target = stages.find((item) => item.id === next);
            if (target) onRequestMove(deal, target);
          }}
        >
          <SelectTrigger id="deal-stage">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {stageItems.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      {deal.won_at && (
        <p className="text-sm text-green">
          {t("wonOn", { date: formatDate(new Date(deal.won_at), settings) })}
        </p>
      )}
      {deal.lost_at && (
        <p className="text-sm text-pink">
          {t("lostOn", { date: formatDate(new Date(deal.lost_at), settings) })}
        </p>
      )}

      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <DealFormFields
          idPrefix="deal"
          draft={draft}
          errors={errors}
          showLostReason={stage?.is_lost === true}
          onChange={(patch) => {
            setStatus("idle");
            setDraft((current) => ({ ...current, ...patch }));
          }}
        />
        {status === "failed" && <FormAlert>{t("saveFailed")}</FormAlert>}
        <div className="flex items-center justify-between gap-3">
          <p role="status" className="text-sm text-green">
            {status === "saved" ? t("saved") : ""}
          </p>
          <Button type="submit" disabled={update.isPending}>
            {t("save")}
          </Button>
        </div>
      </form>

      <section
        aria-labelledby="deal-history"
        className="flex flex-col gap-2 border-t border-line pt-5"
      >
        <h3 id="deal-history" className="micro-label">
          {t("history")}
        </h3>
        <p className="flex items-center gap-2 rounded-xl border border-dashed border-line px-3 py-4 text-sm text-ink-muted">
          <HistoryIcon aria-hidden className="size-4 shrink-0" />
          {t("historyEmpty")}
        </p>
      </section>

      <Button type="button" variant="destructive" onClick={() => setConfirmingDelete(true)}>
        <Trash2Icon aria-hidden data-icon="inline-start" />
        {t("delete")}
      </Button>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t("deleteTitle")}
        description={t("deleteDescription", { title: deal.title })}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        closeLabel={t("close")}
        pending={remove.isPending}
        error={remove.isError ? t("deleteFailed") : null}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
