"use client";

import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toneFill, type Tone } from "@/components/ui/tone";
import { formatDayMonth, formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useIsPhone } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { contactLabel } from "./board-logic";
import {
  HEALTH_TILES,
  healthLevel,
  type HealthLevel,
  type HealthRow,
  type HealthTile,
  type PipelineHealth,
} from "./health";
import { stageTone, type Stage } from "./types";

/** Green at zero, yellow up to three, red above: the design's green, gold and pink. */
const LEVEL_STYLE: Record<HealthLevel, { card: string; number: string; state: string }> = {
  ok: {
    card: "border-green/35 bg-green/8",
    number: "text-green",
    state: "text-green",
  },
  warn: {
    card: "border-gold/45 bg-gold/10",
    number: "text-gold",
    state: "text-gold",
  },
  alert: {
    card: "border-pink/50 bg-pink/10",
    number: "text-pink",
    state: "text-pink",
  },
};

export const HEALTH_LIST_ID = "pipeline-health-list";

type TilesProps = {
  health: PipelineHealth | null;
  pending: boolean;
  failed: boolean;
  onRetry: () => void;
  /** The tile whose list is open (above the pipeline), or none. */
  expanded?: HealthTile | null;
  onSelect: (tile: HealthTile) => void;
  /** On the dashboard a tile leads to the pipeline instead of opening a list here. */
  linksToPipeline?: boolean;
};

/**
 * The three tiles of what is wrong in the pipeline; zero everywhere is the
 * goal. In one row on every screen, so a phone sees all three at a glance.
 */
export function HealthTiles({
  health,
  pending,
  failed,
  onRetry,
  expanded = null,
  onSelect,
  linksToPipeline = false,
}: TilesProps) {
  const t = useTranslations("pipeline.health");
  const settings = useFormatSettings();

  if (failed && !health) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-sm text-ink-soft">
        <span>{t("loadFailed")}</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  return (
    <ul aria-label={t("label")} className="grid grid-cols-3 gap-2 md:gap-3">
      {HEALTH_TILES.map((tile) => {
        const label = t(`tiles.${tile}.label`);
        if (pending || !health) {
          return (
            <li key={tile}>
              <Skeleton className="h-24 rounded-card md:h-28" />
            </li>
          );
        }
        const count = health[tile].count;
        const level = healthLevel(count);
        const style = LEVEL_STYLE[level];
        const open = expanded === tile;
        const formatted = formatNumber(count, {}, settings);
        const StateIcon = level === "ok" ? CheckCircle2Icon : AlertTriangleIcon;
        return (
          <li key={tile} className="min-w-0">
            <button
              type="button"
              data-tile={tile}
              data-level={level}
              data-count={count}
              aria-label={
                linksToPipeline
                  ? t("openInPipeline", { label, count: formatted })
                  : t("toggle", { label, count: formatted })
              }
              aria-expanded={linksToPipeline ? undefined : open}
              aria-controls={linksToPipeline || !open ? undefined : HEALTH_LIST_ID}
              onClick={() => onSelect(tile)}
              className={cn(
                "group flex h-full min-h-24 w-full cursor-pointer flex-col gap-1.5 rounded-card border p-3 text-left outline-none transition-[border-color,background-color,box-shadow] duration-200 hover:shadow-glow focus-visible:ring-3 focus-visible:ring-violet/40 md:min-h-28 md:gap-2 md:p-4",
                style.card,
                open && "shadow-glow ring-2 ring-violet/50",
              )}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="line-clamp-2 text-xs leading-snug font-medium text-ink-soft md:text-sm">
                  {label}
                </span>
                {linksToPipeline ? (
                  <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-ink-muted" />
                ) : (
                  <ChevronDownIcon
                    aria-hidden
                    className={cn(
                      "size-4 shrink-0 text-ink-muted transition-transform duration-200 motion-reduce:transition-none",
                      open && "rotate-180",
                    )}
                  />
                )}
              </span>
              <AnimatedNumber
                value={count}
                duration={0.6}
                className={cn("stat-number text-2xl md:text-3xl", style.number)}
              />
              <span className={cn("mt-auto flex items-center gap-1 text-xs", style.state)}>
                <StateIcon aria-hidden className="size-3.5 shrink-0" />
                {/* A phone shows the icon only; the words would not fit three tiles in a row. */}
                <span className="hidden truncate md:inline">
                  {level === "ok" ? t("ok") : t(`tiles.${tile}.hint`)}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

type ListProps = {
  tile: HealthTile;
  rows: HealthRow[];
  stages: Stage[];
  onOpenDeal: (dealId: string) => void;
};

/** The deals behind one tile: what is wrong with each, a tap opens the deal to fix it. */
export function HealthList({ tile, rows, stages, onOpenDeal }: ListProps) {
  const t = useTranslations("pipeline.health");
  const settings = useFormatSettings();
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));

  if (rows.length === 0) {
    return (
      <p className="flex items-center gap-2 px-1 py-3 text-sm text-green">
        <CheckCircle2Icon aria-hidden className="size-4 shrink-0" />
        {t("listEmpty")}
      </p>
    );
  }

  function problem(row: HealthRow): string {
    const formatted = formatNumber(row.days, {}, settings);
    switch (row.tile) {
      case "closePast":
        return t("row.closePast", { date: formatDayMonth(row.closeDate, settings) });
      case "overdueTasks":
        return t("row.overdueTasks", {
          tasks: row.tasks,
          tasksFormatted: formatNumber(row.tasks, {}, settings),
          days: row.days,
          formatted,
        });
      case "noTask":
        return t("row.noTask", { days: row.days, formatted });
    }
  }

  return (
    <ul aria-label={t(`tiles.${tile}.label`)} className="flex flex-col divide-y divide-line">
      {rows.map((row) => {
        const stage = stageById.get(row.deal.stage_id);
        const contact = row.deal.contact ? contactLabel(row.deal.contact) : t("row.noContact");
        const tone: Tone = stage ? stageTone(stage.color) : "neutral";
        return (
          <li key={row.deal.id}>
            <button
              type="button"
              aria-label={t("row.open", { title: row.deal.title })}
              onClick={() => onOpenDeal(row.deal.id)}
              className="flex min-h-14 w-full cursor-pointer flex-col gap-1 rounded-lg px-2 py-2.5 text-left outline-none hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:ring-3 focus-visible:ring-violet/40 sm:flex-row sm:items-center sm:gap-4 mouse:min-h-11"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-semibold text-ink">{row.deal.title}</span>
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-soft">
                  {stage && (
                    <>
                      <span
                        aria-hidden
                        className={cn("size-2 shrink-0 rounded-full", toneFill[tone])}
                      />
                      <span className="truncate">{stage.name}</span>
                      <span aria-hidden>·</span>
                    </>
                  )}
                  <span className="truncate">{contact}</span>
                </span>
              </span>
              <span className="shrink-0 text-xs font-medium text-pink sm:text-right">
                {problem(row)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

type PanelProps = {
  health: PipelineHealth | null;
  pending: boolean;
  failed: boolean;
  onRetry: () => void;
  stages: Stage[];
  expanded: HealthTile | null;
  onExpand: (tile: HealthTile | null) => void;
  onOpenDeal: (dealId: string) => void;
  /** While a deal is open over the board, the phone's panel steps aside and comes back after. */
  dealOpen: boolean;
};

/**
 * Above the pipeline: the tiles, and under the one tapped the deals behind it
 * (a panel from the bottom on a phone). A second tap folds it away again.
 */
export function PipelineHealthPanel({
  health,
  pending,
  failed,
  onRetry,
  stages,
  expanded,
  onExpand,
  onOpenDeal,
  dealOpen,
}: PanelProps) {
  const t = useTranslations("pipeline.health");
  const isPhone = useIsPhone();
  const rows = expanded && health ? health[expanded].rows : [];

  const list = expanded && health && (
    <HealthList tile={expanded} rows={rows} stages={stages} onOpenDeal={onOpenDeal} />
  );

  return (
    <div className="flex flex-col gap-2">
      <HealthTiles
        health={health}
        pending={pending}
        failed={failed}
        onRetry={onRetry}
        expanded={expanded}
        onSelect={(tile) => onExpand(expanded === tile ? null : tile)}
      />
      {isPhone ? (
        <BottomSheet
          open={Boolean(expanded && health) && !dealOpen}
          onOpenChange={(open) => !open && onExpand(null)}
          title={expanded ? t(`tiles.${expanded}.label`) : ""}
          closeLabel={t("close")}
        >
          <div id={HEALTH_LIST_ID}>{list}</div>
        </BottomSheet>
      ) : (
        list && (
          <div
            id={HEALTH_LIST_ID}
            className="rounded-card border border-line bg-surface px-2 py-1 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1"
          >
            {list}
          </div>
        )
      )}
    </div>
  );
}
