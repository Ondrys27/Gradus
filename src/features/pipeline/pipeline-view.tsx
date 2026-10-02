"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckIcon, KanbanIcon, PencilIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useCelebration } from "@/components/celebration/celebration-provider";
import { useUserSettings } from "@/features/account/queries";
import { MeetingSurveyDialog, type SurveyTarget } from "@/features/dashboard/meeting-survey-dialog";
import { offersMeetingSurvey } from "@/features/dashboard/survey-trigger";
import { useAwardXp } from "@/features/gamification/queries";
import { useUrlIntent } from "@/lib/use-url-intent";
import { Board } from "./board";
import { groupDealsByStage, moveKind, reorderStages, sortStages } from "./board-logic";
import { DealDetail } from "./deal-detail";
import { DealFormDialog } from "./deal-form-dialog";
import { LostReasonDialog } from "./lost-reason-dialog";
import { useDeals, useMoveDeal, useRenameStage, useReorderStages, useStages } from "./queries";
import { AddStageDialog, RemoveStageDialog } from "./stage-dialogs";
import { useCan } from "@/features/account/workspace-queries";
import type { Deal, Stage } from "./types";

export function PipelineView() {
  const t = useTranslations("pipeline");
  const tNav = useTranslations("nav");
  const { celebrate } = useCelebration();
  const awardXp = useAwardXp();
  const settings = useUserSettings();
  const stagesQuery = useStages();
  const dealsQuery = useDeals();
  const move = useMoveDeal();
  const rename = useRenameStage();
  const reorder = useReorderStages();
  // Without the right to edit, adding, moving and stage changes are hidden; RLS refuses them anyway.
  const canEdit = useCan("pipeline", "edit");

  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState<{ stageId: string | null } | null>(null);
  const [addingStage, setAddingStage] = useState(false);
  const [removing, setRemoving] = useState<Stage | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  // The calendar links to a deal as /pipeline?deal=<id>; the panel opens on it.
  const requestedDeal = useSearchParams().get("deal");
  const [openId, setOpenId] = useState<string | null>(requestedDeal);
  // The search can ask for another deal while the board is already open.
  const [seenRequest, setSeenRequest] = useState(requestedDeal);
  if (requestedDeal !== seenRequest) {
    setSeenRequest(requestedDeal);
    if (requestedDeal) setOpenId(requestedDeal);
  }
  useUrlIntent("new", (value) => {
    if (value !== "deal" || !canEdit) return;
    if (stagesQuery.isPending) return false;
    if (stagesQuery.data?.length) setCreating({ stageId: null });
  });
  const [askingLost, setAskingLost] = useState<Deal | null>(null);
  const [lostStage, setLostStage] = useState<Stage | null>(null);
  const [survey, setSurvey] = useState<SurveyTarget | null>(null);
  const [notice, setNotice] = useState<"moveFailed" | "renameFailed" | null>(null);

  const stages = useMemo(() => sortStages(stagesQuery.data ?? []), [stagesQuery.data]);
  const deals = useMemo(() => dealsQuery.data ?? [], [dealsQuery.data]);

  // Each lost stage's column filters its own deals; every column always gets the full list.
  const dealsByStage = useMemo(() => groupDealsByStage(stages, deals), [stages, deals]);

  const openDeal = deals.find((deal) => deal.id === openId) ?? null;

  function celebrateWon(deal: Deal) {
    awardXp.mutate(
      { kind: "deal_won", idempotencyKey: deal.id },
      {
        onSuccess: ({ awarded, xp }) =>
          celebrate({
            title: t("celebration.title"),
            subtitle: deal.title,
            xp: awarded ? xp : undefined,
          }),
      },
    );
  }

  function runMove(deal: Deal, stage: Stage, lostReason?: string) {
    setNotice(null);
    const from = stages.find((item) => item.id === deal.stage_id);
    move.mutate(
      { deal, stage, lostReason },
      {
        onSuccess: () => {
          if (stage.is_won) celebrateWon(deal);
          // A deal that moves on from the meeting stage has had its meeting: ask how it went.
          if (from && offersMeetingSurvey(from, stage)) {
            setSurvey({ dealId: deal.id, dealTitle: deal.title, stageId: from.id });
          }
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

  const headerActions = !canEdit ? null : editing ? (
    <Button onClick={() => setEditing(false)}>
      <CheckIcon aria-hidden data-icon="inline-start" />
      {t("actions.doneEditing")}
    </Button>
  ) : (
    <>
      <Button variant="outline" disabled={stages.length === 0} onClick={() => setEditing(true)}>
        <PencilIcon aria-hidden data-icon="inline-start" />
        {t("actions.editStages")}
      </Button>
      <Button
        variant="outline"
        size="icon"
        aria-label={t("actions.addStage")}
        title={t("actions.addStage")}
        onClick={() => setAddingStage(true)}
      >
        <PlusIcon aria-hidden />
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
                canEdit && (
                  <Button onClick={() => setCreating({ stageId: null })}>
                    <PlusIcon aria-hidden data-icon="inline-start" />
                    {t("empty.action")}
                  </Button>
                )
              }
            />
          )}
          <Board
            stages={stages}
            dealsByStage={dealsByStage}
            editing={editing && canEdit}
            readOnly={!canEdit}
            reengageAfterMonths={settings.reengage_after_months}
            onAddStage={() => setAddingStage(true)}
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
          if (stage.is_won) celebrateWon(deal);
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
      <MeetingSurveyDialog target={survey} onClose={() => setSurvey(null)} />
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
