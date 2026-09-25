"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckIcon, KanbanIcon, PencilIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useCelebration } from "@/components/celebration/celebration-provider";
import { cn } from "@/lib/utils";
import { Board } from "./board";
import {
  countRelaunchable,
  groupDealsByStage,
  isRelaunchable,
  moveKind,
  reorderStages,
  sortStages,
} from "./board-logic";
import { DealDetail } from "./deal-detail";
import { DealFormDialog } from "./deal-form-dialog";
import { LostReasonDialog } from "./lost-reason-dialog";
import { useDeals, useMoveDeal, useRenameStage, useReorderStages, useStages } from "./queries";
import { AddStageDialog, RemoveStageDialog } from "./stage-dialogs";
import type { Deal, Stage } from "./types";

export function PipelineView() {
  const t = useTranslations("pipeline");
  const tNav = useTranslations("nav");
  const { celebrate } = useCelebration();
  const stagesQuery = useStages();
  const dealsQuery = useDeals();
  const move = useMoveDeal();
  const rename = useRenameStage();
  const reorder = useReorderStages();

  const [editing, setEditing] = useState(false);
  const [relaunchOnly, setRelaunchOnly] = useState(false);
  const [creating, setCreating] = useState<{ stageId: string | null } | null>(null);
  const [addingStage, setAddingStage] = useState(false);
  const [removing, setRemoving] = useState<Stage | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  // The calendar links to a deal as /pipeline?deal=<id>; the panel opens on it.
  const requestedDeal = useSearchParams().get("deal");
  const [openId, setOpenId] = useState<string | null>(requestedDeal);
  const [askingLost, setAskingLost] = useState<Deal | null>(null);
  const [lostStage, setLostStage] = useState<Stage | null>(null);
  const [notice, setNotice] = useState<"moveFailed" | "renameFailed" | null>(null);

  const stages = useMemo(() => sortStages(stagesQuery.data ?? []), [stagesQuery.data]);
  const deals = useMemo(() => dealsQuery.data ?? [], [dealsQuery.data]);
  const now = new Date();

  const relaunchCount = countRelaunchable(stages, deals, now);
  const dealsByStage = useMemo(() => {
    const byId = new Map(stages.map((stage) => [stage.id, stage]));
    const shown = relaunchOnly
      ? deals.filter((deal) => isRelaunchable(deal, byId.get(deal.stage_id)))
      : deals;
    return groupDealsByStage(stages, shown);
  }, [stages, deals, relaunchOnly]);

  const openDeal = deals.find((deal) => deal.id === openId) ?? null;

  function runMove(deal: Deal, stage: Stage, lostReason?: string) {
    setNotice(null);
    move.mutate(
      { deal, stage, lostReason },
      {
        onSuccess: () => {
          if (stage.is_won) celebrate({ title: t("celebration.title"), subtitle: deal.title });
        },
        onError: () => setNotice("moveFailed"),
      },
    );
  }

  /** Every way of changing a stage (drag, detail) passes here. Lost asks for a reason first. */
  function requestMove(deal: Deal, stage: Stage) {
    const kind = moveKind(deal, stage);
    if (kind === "none") return;
    if (kind === "lost") {
      setAskingLost(deal);
      setLostStage(stage);
      return;
    }
    runMove(deal, stage);
  }

  function stopAskingLost() {
    setAskingLost(null);
    setLostStage(null);
  }

  const headerActions = editing ? (
    <>
      <Button variant="outline" onClick={() => setAddingStage(true)}>
        <PlusIcon aria-hidden data-icon="inline-start" />
        {t("actions.addStage")}
      </Button>
      <Button onClick={() => setEditing(false)}>
        <CheckIcon aria-hidden data-icon="inline-start" />
        {t("actions.doneEditing")}
      </Button>
    </>
  ) : (
    <>
      <Button variant="outline" disabled={stages.length === 0} onClick={() => setEditing(true)}>
        <PencilIcon aria-hidden data-icon="inline-start" />
        {t("actions.editStages")}
      </Button>
      <Button disabled={stages.length === 0} onClick={() => setCreating({ stageId: null })}>
        <PlusIcon aria-hidden data-icon="inline-start" />
        {t("actions.newDeal")}
      </Button>
    </>
  );

  const loading = stagesQuery.isPending || dealsQuery.isPending;
  const failed = stagesQuery.isError || dealsQuery.isError;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={tNav("pipeline")} description={t("description")} actions={headerActions} />

      {(relaunchCount > 0 || relaunchOnly) && (
        <div role="group" aria-label={t("filter.label")} className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={relaunchOnly}
            onClick={() => setRelaunchOnly((value) => !value)}
            className={cn(
              "inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-gold/40 mouse:h-9",
              relaunchOnly
                ? "border-gold/60 bg-gold/15 text-ink"
                : "border-gold/30 text-gold hover:border-gold/60",
            )}
          >
            <RotateCcwIcon aria-hidden className="size-4" />
            {t("filter.relaunch", { count: relaunchCount })}
          </button>
        </div>
      )}

      {notice && <FormAlert>{t(`notices.${notice}`)}</FormAlert>}

      {loading ? (
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-72 w-72 shrink-0 rounded-card" />
          ))}
        </div>
      ) : failed ? (
        <EmptyState
          icon={<KanbanIcon />}
          title={t("loadFailed")}
          action={
            <Button
              variant="outline"
              onClick={() => {
                void stagesQuery.refetch();
                void dealsQuery.refetch();
              }}
            >
              {t("retry")}
            </Button>
          }
        />
      ) : (
        <>
          {deals.length === 0 && !editing && (
            <EmptyState
              icon={<KanbanIcon />}
              title={t("empty.title")}
              description={t("empty.description")}
              action={
                <Button onClick={() => setCreating({ stageId: null })}>
                  <PlusIcon aria-hidden data-icon="inline-start" />
                  {t("empty.action")}
                </Button>
              }
            />
          )}
          <Board
            stages={stages}
            dealsByStage={dealsByStage}
            editing={editing}
            onAddDeal={(stage) => setCreating({ stageId: stage.id })}
            onOpenDeal={(deal) => setOpenId(deal.id)}
            onMoveDeal={requestMove}
            onReorderStages={(activeId, overId) =>
              reorder.mutate({
                activeId,
                overId,
                changes: reorderStages(stages, activeId, overId).changes,
              })
            }
            onRenameStage={(stage, name) => {
              setNotice(null);
              rename.mutate({ id: stage.id, name }, { onError: () => setNotice("renameFailed") });
            }}
            onRemoveStage={setRemoving}
          />
        </>
      )}

      <DealFormDialog
        open={creating !== null}
        onOpenChange={(open) => {
          if (!open) setCreating(null);
        }}
        stages={stages}
        stageId={creating?.stageId ?? null}
        onCreated={(deal, stage) => {
          if (stage.is_won) celebrate({ title: t("celebration.title"), subtitle: deal.title });
        }}
      />
      <DealDetail
        deal={openDeal}
        stages={stages}
        onClose={() => {
          setOpenId(null);
          if (requestedDeal) router.replace(pathname, { scroll: false });
        }}
        onRequestMove={requestMove}
      />
      <LostReasonDialog
        deal={askingLost}
        onCancel={stopAskingLost}
        onConfirm={(deal, reason) => {
          if (lostStage) runMove(deal, lostStage, reason);
          stopAskingLost();
        }}
      />
      <AddStageDialog open={addingStage} onOpenChange={setAddingStage} />
      <RemoveStageDialog
        stage={removing}
        stages={stages}
        dealCount={removing ? deals.filter((deal) => deal.stage_id === removing.id).length : 0}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}
