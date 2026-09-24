"use client";

import { useEffect, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { toneFill } from "@/components/ui/tone";
import { formatCurrency } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { isRelaunchable, sumByCurrency } from "./board-logic";
import { DealCard } from "./deal-card";
import { STAGE_NAME_MAX } from "./schemas";
import { stageTone, type Deal, type Stage } from "./types";

type Props = {
  stage: Stage;
  /** Deals to show (the filter may hide some); totals and the count follow it. */
  deals: Deal[];
  editing: boolean;
  dragDealsEnabled: boolean;
  isLastStage: boolean;
  onAddDeal: (stage: Stage) => void;
  onOpenDeal: (deal: Deal) => void;
  onRename: (stage: Stage, name: string) => void;
  onRemove: (stage: Stage) => void;
};

export function StageColumn({
  stage,
  deals,
  editing,
  dragDealsEnabled,
  isLastStage,
  onAddDeal,
  onOpenDeal,
  onRename,
  onRemove,
}: Props) {
  const t = useTranslations("pipeline");
  const settings = useFormatSettings();
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isOver } =
    useSortable({ id: stage.id, disabled: { draggable: !editing }, data: { type: "stage" } });
  const now = new Date();
  const totals = sumByCurrency(deals);

  return (
    <section
      ref={setNodeRef}
      aria-label={stage.name}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "flex w-[min(85vw,20rem)] shrink-0 snap-center flex-col gap-3 rounded-card border bg-surface/50 p-3 md:w-72 md:snap-align-none",
        stage.is_won ? "border-green/60" : stage.is_lost ? "border-pink/60" : "border-line",
        isOver && !editing && "border-violet/70 bg-violet/8",
      )}
    >
      <header className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          {editing && (
            <button
              ref={setActivatorNodeRef}
              type="button"
              aria-label={t("stage.drag", { name: stage.name })}
              {...attributes}
              {...listeners}
              className="-ml-1 grid size-11 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-8"
            >
              <GripVerticalIcon aria-hidden className="size-4" />
            </button>
          )}
          <span
            aria-hidden
            className={cn("size-2.5 shrink-0 rounded-full", toneFill[stageTone(stage.color)])}
          />
          {editing ? (
            <StageNameInput stage={stage} onRename={onRename} />
          ) : (
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{stage.name}</h2>
          )}
          <span className="shrink-0 rounded-full bg-surface-hover px-2 py-0.5 text-xs font-semibold text-ink-soft tabular-nums">
            {deals.length}
          </span>
          {editing ? (
            <button
              type="button"
              disabled={isLastStage}
              title={isLastStage ? t("stage.lastStage") : undefined}
              aria-label={t("stage.remove", { name: stage.name })}
              onClick={() => onRemove(stage)}
              className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:text-pink focus-visible:ring-3 focus-visible:ring-pink/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-ink-soft mouse:size-8"
            >
              <Trash2Icon aria-hidden className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              aria-label={t("column.addDeal", { name: stage.name })}
              onClick={() => onAddDeal(stage)}
              className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-8"
            >
              <PlusIcon aria-hidden className="size-4" />
            </button>
          )}
        </div>
        <p className="min-h-4 truncate text-xs text-ink-muted tabular-nums">
          {totals.map((sum) => formatCurrency(sum.total, sum.currency, settings)).join(" · ")}
        </p>
        {editing && isLastStage && <p className="text-xs text-ink-muted">{t("stage.lastStage")}</p>}
      </header>

      <div className="flex min-h-16 flex-col gap-2">
        {deals.length === 0 ? (
          <p className="grid flex-1 place-items-center rounded-xl border border-dashed border-line py-6 text-xs text-ink-muted">
            {t("column.empty")}
          </p>
        ) : (
          deals.map((deal) => (
            <DealCard
              key={deal.id}
              deal={deal}
              muted={stage.is_lost}
              relaunchable={isRelaunchable(deal, stage, now)}
              draggable={dragDealsEnabled && !editing}
              onOpen={onOpenDeal}
            />
          ))
        )}
      </div>
    </section>
  );
}

/** Renames on blur or Enter; Escape or an empty name puts the old one back. */
function StageNameInput({
  stage,
  onRename,
}: {
  stage: Stage;
  onRename: (stage: Stage, name: string) => void;
}) {
  const t = useTranslations("pipeline.stage");
  const [value, setValue] = useState(stage.name);
  useEffect(() => setValue(stage.name), [stage.name]);

  function commit() {
    const name = value.trim();
    if (!name) setValue(stage.name);
    else if (name !== stage.name) onRename(stage, name);
  }

  return (
    <Input
      value={value}
      maxLength={STAGE_NAME_MAX}
      aria-label={t("rename", { name: stage.name })}
      className="h-11 min-w-0 flex-1 px-2 text-sm font-semibold mouse:h-8"
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setValue(stage.name);
          event.currentTarget.blur();
        }
      }}
    />
  );
}
