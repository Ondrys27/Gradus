"use client";

import { useEffect, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { useReducedMotion } from "framer-motion";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toneFill } from "@/components/ui/tone";
import { track } from "@/lib/analytics/client";
import { formatCurrency } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { isRelaunchable, sumByCurrency } from "./board-logic";
import { DealCard, DealCardBody } from "./deal-card";
import { useSetDepositStage } from "./queries";
import { STAGE_NAME_MAX } from "./schemas";
import { stageTone, type Deal, type Stage } from "./types";

/**
 * A bouncy overshoot curve so sibling stages spring into their new slot while
 * one is being dragged, instead of a plain ease.
 */
const STAGE_TRANSITION = { duration: 320, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" };

type Props = {
  stage: Stage;
  /** All of this stage's deals; the re-engage filter (lost stages only) hides some of them. */
  deals: Deal[];
  editing: boolean;
  dragDealsEnabled: boolean;
  isLastStage: boolean;
  /** From Settings → Pipeline; a lost deal older than this may be approached again. */
  reengageAfterMonths: number;
  /** Absent when the account may not add deals. */
  onAddDeal?: (stage: Stage) => void;
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
  reengageAfterMonths,
  onAddDeal,
  onOpenDeal,
  onRename,
  onRemove,
}: Props) {
  const t = useTranslations("pipeline");
  const settings = useFormatSettings();
  const reduceMotion = useReducedMotion();
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isOver,
    isDragging,
  } = useSortable({
    id: stage.id,
    disabled: { draggable: !editing },
    data: { type: "stage" },
    // The overshoot is only for those who have not asked for less motion.
    transition: reduceMotion ? undefined : STAGE_TRANSITION,
  });
  const now = new Date();
  const [relaunchOnly, setRelaunchOnly] = useState(false);
  const relaunchable = stage.is_lost
    ? deals.filter((deal) => isRelaunchable(deal, stage, now, reengageAfterMonths))
    : [];
  const visibleDeals = stage.is_lost && relaunchOnly ? relaunchable : deals;
  const totals = sumByCurrency(visibleDeals);

  return (
    <section
      ref={setNodeRef}
      aria-label={stage.name}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "flex w-[min(85vw,20rem)] shrink-0 snap-center flex-col gap-3 rounded-card border bg-surface/50 p-3 md:w-72 md:snap-align-none",
        stage.is_won ? "border-green/60" : stage.is_lost ? "border-pink/60" : "border-line",
        isOver && !editing && "border-violet/70 bg-violet/8",
        isDragging && "opacity-30",
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
          ) : onAddDeal ? (
            <button
              type="button"
              aria-label={t("column.addDeal", { name: stage.name })}
              onClick={() => onAddDeal(stage)}
              className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-8"
            >
              <PlusIcon aria-hidden className="size-4" />
            </button>
          ) : null}
        </div>
        <p className="min-h-4 truncate text-xs text-ink-muted tabular-nums">
          {totals.map((sum) => formatCurrency(sum.total, sum.currency, settings)).join(" · ")}
        </p>
        {editing && isLastStage && <p className="text-xs text-ink-muted">{t("stage.lastStage")}</p>}
        {editing && !stage.is_won && !stage.is_lost && <DepositControl stage={stage} />}
        {stage.is_lost && (relaunchable.length > 0 || relaunchOnly) && (
          <button
            type="button"
            aria-pressed={relaunchOnly}
            onClick={() => {
              track("reengage_filter_used", { enabled: !relaunchOnly });
              setRelaunchOnly(!relaunchOnly);
            }}
            className={cn(
              "inline-flex h-11 w-fit cursor-pointer items-center gap-1.5 self-start rounded-full border px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-gold/40 mouse:h-8",
              relaunchOnly
                ? "border-gold/60 bg-gold/15 text-ink"
                : "border-gold/30 text-gold hover:border-gold/60",
            )}
          >
            <RotateCcwIcon aria-hidden className="size-3.5" />
            {t("stage.relaunchFilter", { count: relaunchable.length })}
          </button>
        )}
      </header>

      <div className="flex min-h-16 flex-col gap-2">
        {visibleDeals.length === 0 ? (
          <p className="grid flex-1 place-items-center rounded-xl border border-dashed border-line py-6 text-xs text-ink-muted">
            {t("column.empty")}
          </p>
        ) : (
          visibleDeals.map((deal) => (
            <DealCard
              key={deal.id}
              deal={deal}
              muted={stage.is_lost}
              relaunchable={isRelaunchable(deal, stage, now, reengageAfterMonths)}
              draggable={dragDealsEnabled && !editing}
              onOpen={onOpenDeal}
            />
          ))
        )}
      </div>
    </section>
  );
}

/**
 * Appended after the last stage while editing: a full-height, dashed-border invite to
 * add another one. Tapping it opens the new-stage form directly.
 */
export function AddStageCard({ onClick }: { onClick: () => void }) {
  const t = useTranslations("pipeline.column");
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-[min(85vw,20rem)] shrink-0 snap-center cursor-pointer flex-col items-center justify-center gap-3 self-stretch rounded-card border-2 border-dashed border-violet/40 p-3 text-violet/70 outline-none transition-colors hover:border-violet/70 hover:bg-violet/8 hover:text-violet hover:shadow-glow focus-visible:border-violet/70 focus-visible:bg-violet/8 focus-visible:text-violet focus-visible:ring-3 focus-visible:ring-violet/40 md:w-72 md:snap-align-none",
      )}
    >
      <PlusIcon aria-hidden className="size-10" />
      <span className="text-sm font-semibold">{t("addStage")}</span>
    </button>
  );
}

/**
 * The floating clone shown in the DragOverlay while a stage is being reordered: lifted,
 * tilted and following the pointer freely, while the real column stays muted in its slot.
 */
export function StageDragPreview({ stage, deals }: { stage: Stage; deals: Deal[] }) {
  const t = useTranslations("pipeline");
  const settings = useFormatSettings();
  const totals = sumByCurrency(deals);
  const preview = deals.slice(0, 3);

  return (
    <section
      aria-hidden
      className={cn(
        "flex w-[min(85vw,20rem)] shrink-0 cursor-grabbing flex-col gap-3 rounded-card border bg-surface p-3 shadow-glow-strong md:w-72",
        "motion-safe:scale-[1.03] motion-safe:rotate-2",
        stage.is_won ? "border-green/60" : stage.is_lost ? "border-pink/60" : "border-violet/60",
      )}
    >
      <header className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn("size-2.5 shrink-0 rounded-full", toneFill[stageTone(stage.color)])}
          />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{stage.name}</h2>
          <span className="shrink-0 rounded-full bg-surface-hover px-2 py-0.5 text-xs font-semibold text-ink-soft tabular-nums">
            {deals.length}
          </span>
        </div>
        <p className="min-h-4 truncate text-xs text-ink-muted tabular-nums">
          {totals.map((sum) => formatCurrency(sum.total, sum.currency, settings)).join(" · ")}
        </p>
      </header>
      {preview.length > 0 && (
        <div className="flex flex-col gap-2">
          {preview.map((deal) => (
            <DealCardBody key={deal.id} deal={deal} muted={stage.is_lost} relaunchable={false} />
          ))}
          {deals.length > preview.length && (
            <p className="text-xs text-ink-muted">
              {t("column.more", { count: deals.length - preview.length })}
            </p>
          )}
        </div>
      )}
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

const DEPOSIT_KEY = "deposit_paid";

/** Marks this stage as the one that means "deposit paid", with the deposit's share of the value. */
function DepositControl({ stage }: { stage: Stage }) {
  const t = useTranslations("pipeline.stage");
  const set = useSetDepositStage();
  const isDeposit = stage.system_key === DEPOSIT_KEY;
  const [percent, setPercent] = useState(String(stage.deposit_percent));
  const [failed, setFailed] = useState(false);
  useEffect(() => setPercent(String(stage.deposit_percent)), [stage.deposit_percent]);

  function save(stageId: string | null, value: number) {
    setFailed(false);
    set.mutate({ stageId, percent: value }, { onError: () => setFailed(true) });
  }

  function commitPercent() {
    const value = Number(percent);
    if (!Number.isInteger(value) || value < 1 || value > 100)
      setPercent(String(stage.deposit_percent));
    else if (value !== stage.deposit_percent) save(stage.id, value);
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line px-3 py-1">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <span className="text-xs text-ink-soft">{t("depositLabel")}</span>
        <Switch
          checked={isDeposit}
          disabled={set.isPending}
          aria-label={t("depositLabel")}
          onCheckedChange={(checked) => save(checked ? stage.id : null, stage.deposit_percent)}
        />
      </div>
      {isDeposit && (
        <div className="flex items-center justify-between gap-3 pb-1">
          <label htmlFor={`deposit-${stage.id}`} className="text-xs text-ink-soft">
            {t("depositPercent")}
          </label>
          <Input
            id={`deposit-${stage.id}`}
            value={percent}
            inputMode="numeric"
            className="h-11 w-20 px-2 text-right text-sm mouse:h-8"
            onChange={(event) => setPercent(event.target.value)}
            onBlur={commitPercent}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </div>
      )}
      <p className="pb-1 text-xs text-ink-muted">
        {failed ? t("depositFailed") : t("depositHint")}
      </p>
    </div>
  );
}
