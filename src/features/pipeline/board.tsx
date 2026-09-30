"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { useTranslations } from "next-intl";
import { useIsPhone } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { DealCardBody } from "./deal-card";
import { isRelaunchable } from "./board-logic";
import { AddStageCard, StageColumn, StageDragPreview } from "./stage-column";
import type { Deal, Stage } from "./types";

type Props = {
  stages: Stage[];
  /** Every deal per stage; a lost stage's own filter (in its column) may hide some. */
  dealsByStage: Map<string, Deal[]>;
  editing: boolean;
  /** From Settings → Pipeline; a lost deal older than this may be approached again. */
  reengageAfterMonths: number;
  onAddDeal: (stage: Stage) => void;
  onOpenDeal: (deal: Deal) => void;
  onMoveDeal: (deal: Deal, stage: Stage) => void;
  onReorderStages: (activeId: string, overId: string) => void;
  onRenameStage: (stage: Stage, name: string) => void;
  onRemoveStage: (stage: Stage) => void;
  onAddStage: () => void;
};

/** Pointer position decides the column; a card hovering between columns falls back to overlap. */
const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

export function Board({
  stages,
  dealsByStage,
  editing,
  reengageAfterMonths,
  onAddDeal,
  onOpenDeal,
  onMoveDeal,
  onReorderStages,
  onRenameStage,
  onRemoveStage,
  onAddStage,
}: Props) {
  const t = useTranslations("pipeline.a11y");
  const isPhone = useIsPhone();
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);
  const [activeStage, setActiveStage] = useState<Stage | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );

  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const dealById = (id: unknown) => {
    for (const list of dealsByStage.values()) {
      const found = list.find((deal) => deal.id === id);
      if (found) return found;
    }
    return undefined;
  };
  const nameOf = (id: unknown) =>
    stageById.get(String(id))?.name ?? dealById(id)?.title ?? String(id);

  const announcements: Announcements = {
    onDragStart: ({ active }) => t("pickedUp", { name: nameOf(active.id) }),
    onDragOver: ({ active, over }) =>
      over ? t("over", { name: nameOf(active.id), target: nameOf(over.id) }) : undefined,
    onDragEnd: ({ active, over }) =>
      over ? t("dropped", { name: nameOf(active.id), target: nameOf(over.id) }) : t("cancelled"),
    onDragCancel: () => t("cancelled"),
  };

  function handleDragStart({ active }: DragStartEvent) {
    if (active.data.current?.type === "deal") setActiveDeal(active.data.current.deal as Deal);
    if (active.data.current?.type === "stage")
      setActiveStage(stageById.get(String(active.id)) ?? null);
  }

  function resetDrag() {
    setActiveDeal(null);
    setActiveStage(null);
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    resetDrag();
    if (!over) return;
    if (active.data.current?.type === "stage") {
      if (active.id !== over.id) onReorderStages(String(active.id), String(over.id));
      return;
    }
    const deal = active.data.current?.deal as Deal | undefined;
    const target = stageById.get(String(over.id));
    if (deal && target) onMoveDeal(deal, target);
  }

  const now = new Date();

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: t("instructions") },
      }}
      onDragStart={handleDragStart}
      onDragCancel={resetDrag}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={stages.map((stage) => stage.id)}
        strategy={horizontalListSortingStrategy}
      >
        <div
          className={cn(
            "-mx-4 flex snap-x snap-mandatory items-start gap-3 overflow-x-auto px-4 pb-4 [scroll-padding-inline:16px] md:mx-0 md:snap-none md:px-0 md:pb-3",
          )}
        >
          {stages.map((stage) => (
            <StageColumn
              key={stage.id}
              stage={stage}
              deals={dealsByStage.get(stage.id) ?? []}
              editing={editing}
              dragDealsEnabled={!isPhone}
              isLastStage={stages.length === 1}
              reengageAfterMonths={reengageAfterMonths}
              onAddDeal={onAddDeal}
              onOpenDeal={onOpenDeal}
              onRename={onRenameStage}
              onRemove={onRemoveStage}
            />
          ))}
          {editing && <AddStageCard onClick={onAddStage} />}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={activeStage ? undefined : null}>
        {activeDeal && (
          <DealCardBody
            deal={activeDeal}
            muted={stageById.get(activeDeal.stage_id)?.is_lost ?? false}
            relaunchable={isRelaunchable(
              activeDeal,
              stageById.get(activeDeal.stage_id),
              now,
              reengageAfterMonths,
            )}
            className="cursor-grabbing border-violet/60 shadow-glow-strong motion-safe:rotate-3 motion-safe:scale-105"
          />
        )}
        {activeStage && (
          <StageDragPreview stage={activeStage} deals={dealsByStage.get(activeStage.id) ?? []} />
        )}
      </DragOverlay>
    </DndContext>
  );
}
