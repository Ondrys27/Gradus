"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession, useUserSettings } from "@/features/account/queries";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { sortStages } from "./board-logic";
import { dealTitleFor, openStages, startingStageId } from "./contact-deals";
import { NewDealForm } from "./deal-form-dialog";
import { useLinkBookedMeeting, useStages, type DealSource } from "./queries";
import type { Deal, DealContact } from "./types";

type FormProps = {
  contact: DealContact;
  /** Cold Calling starts in the stage picked in its settings; elsewhere the first open stage. */
  source: Extract<DealSource, "contact" | "cold_calling">;
  /** Right after a move that booked a meeting: the deal takes that meeting along. */
  linkMeeting?: boolean;
  onCancel: () => void;
  onCreated: (deal: Deal) => void;
  cancelLabel?: string;
};

/**
 * A new deal for one contact: named after it, with it as the primary contact,
 * looked after by whoever makes it (the caller in Cold Calling), in an open stage.
 */
export function NewDealFromContactForm({
  contact,
  source,
  linkMeeting = false,
  onCancel,
  onCreated,
  cancelLabel,
}: FormProps) {
  const t = useTranslations("pipeline.fromContact");
  const { user } = useSession();
  const preferred = useUserSettings().cold_calling_deal_stage_id;
  const stagesQuery = useStages();
  const link = useLinkBookedMeeting();
  const stages = useMemo(
    () => openStages(sortStages(stagesQuery.data ?? [])),
    [stagesQuery.data],
  );

  if (stagesQuery.isPending) return <Skeleton className="h-72 rounded-xl" />;
  if (stagesQuery.isError || stages.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <FormAlert>{t(stagesQuery.isError ? "loadFailed" : "noStages")}</FormAlert>
        <Button variant="ghost" className="self-end" onClick={onCancel}>
          {cancelLabel ?? t("cancel")}
        </Button>
      </div>
    );
  }

  return (
    <NewDealForm
      stages={stages}
      stageId={startingStageId(stages, source === "cold_calling" ? preferred : null)}
      initial={{ title: dealTitleFor(contact), contact, assigneeId: user.id }}
      showAssignee
      source={source}
      afterCreate={linkMeeting ? (deal) => link.mutateAsync(deal.id) : undefined}
      onCancel={onCancel}
      onCreated={(deal) => onCreated(deal)}
      cancelLabel={cancelLabel}
    />
  );
}

export function NewDealFromContactDialog({
  open,
  onOpenChange,
  ...props
}: Omit<FormProps, "onCancel"> & { open: boolean; onOpenChange: (open: boolean) => void }) {
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
      <NewDealFromContactForm
        key={generation}
        {...props}
        onCancel={() => onOpenChange(false)}
        onCreated={(deal) => {
          onOpenChange(false);
          props.onCreated(deal);
        }}
      />
    </ResponsiveDialog>
  );
}
