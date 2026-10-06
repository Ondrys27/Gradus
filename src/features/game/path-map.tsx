"use client";

import Link from "next/link";
import { CheckIcon, LockIcon, MapIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { EmptyState } from "@/components/ui/empty-state";
import { GlowCard } from "@/components/ui/glow-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { useDefinitions, usePathProgress } from "./overview-queries";
import type { ChapterProgress, StepProgress } from "./path-progress";
import { localized } from "./types";

/** Height of one step on the map, px. */
const ROW = 112;
/** Steps zigzag between these two positions (percent of the width). */
const LANES = [28, 72] as const;

/**
 * The path as a vertical map: chapters as stretches, milestones as nodes on
 * a winding line. Done is turquoise, the current step violet with a glow,
 * later steps muted; each carries what it unlocks or its XP. A tap opens the
 * milestone.
 */
export function PathMap() {
  const t = useTranslations("game.path");
  const path = usePathProgress();

  if (path.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-16 rounded-card" />
        <Skeleton className="h-96 rounded-card" />
      </div>
    );
  }
  if (!path.data || path.data.total === 0) {
    return (
      <EmptyState icon={<MapIcon />} title={t("emptyTitle")} description={t("emptyDescription")} />
    );
  }
  return (
    <ol className="flex flex-col gap-6" aria-label={t("label")}>
      {path.data.chapters.map((chapter) => (
        <li key={chapter.chapter}>
          <ChapterStretch chapter={chapter} />
        </li>
      ))}
    </ol>
  );
}

function ChapterStretch({ chapter }: { chapter: ChapterProgress }) {
  const t = useTranslations("game.path");
  const settings = useFormatSettings();
  const n = (value: number) => formatNumber(value, {}, settings);
  const height = chapter.steps.length * ROW;
  const points = chapter.steps.map((_, index) => ({
    x: LANES[index % 2]!,
    y: index * ROW + ROW / 2,
  }));

  // One cubic segment between each pair of nodes, bending vertically.
  const segment = (from: { x: number; y: number }, to: { x: number; y: number }) =>
    `M ${from.x} ${from.y} C ${from.x} ${from.y + ROW / 2} ${to.x} ${to.y - ROW / 2} ${to.x} ${to.y}`;
  const segments = points.slice(1).map((point, index) => ({
    d: segment(points[index]!, point),
    // Lit from a done step onward to the next one.
    lit: chapter.steps[index]!.state === "done",
  }));

  return (
    <GlowCard interactive={false} className="flex flex-col gap-4 md:p-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">
            <span className="micro-label mr-2 align-middle">
              {t("chapter", { number: n(chapter.chapter) })}
            </span>
            {t(`chapters.${chapter.chapter}`)}
          </h2>
          <span className="shrink-0 text-sm font-semibold text-ink tabular-nums">
            {t("progress", { done: n(chapter.done), total: n(chapter.total) })}
          </span>
        </div>
        <ProgressBar
          size="sm"
          value={chapter.done}
          max={chapter.total}
          label={t(`chapters.${chapter.chapter}`)}
        />
      </header>

      <div className="relative" style={{ height }}>
        <svg
          aria-hidden
          className="absolute inset-0 size-full overflow-visible"
          viewBox={`0 0 100 ${height}`}
          preserveAspectRatio="none"
        >
          {segments.map((s, index) => (
            <g key={index}>
              {/* Two layers: the line itself and, once walked, a glowing turquoise stroke. */}
              <path
                d={s.d}
                fill="none"
                vectorEffect="non-scaling-stroke"
                strokeWidth={4}
                strokeLinecap="round"
                className="stroke-line"
                strokeDasharray={s.lit ? undefined : "2 8"}
              />
              {s.lit && (
                <path
                  d={s.d}
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                  strokeWidth={3}
                  strokeLinecap="round"
                  className="stroke-teal drop-shadow-[0_0_6px_var(--color-teal)]"
                />
              )}
            </g>
          ))}
        </svg>
        {chapter.steps.map((step, index) => (
          <StepNode key={step.key} step={step} x={points[index]!.x} y={points[index]!.y} />
        ))}
      </div>
    </GlowCard>
  );
}

function StepNode({ step, x, y }: { step: StepProgress; x: number; y: number }) {
  const t = useTranslations("game.path");
  const locale = useLocale();
  const settings = useFormatSettings();
  const definitions = useDefinitions();
  const unlock = step.unlockKey ? definitions.data?.unlocks.get(step.unlockKey) : undefined;
  const title = step.ownTitle ?? localized(step.title, locale);
  const labelLeft = x > 50;
  const chip = unlock
    ? t("unlocks", { name: localized(unlock.name, locale) })
    : t("xp", { xp: formatNumber(step.xp, {}, settings) });

  const node = (
    <span
      className={cn(
        "relative grid size-14 shrink-0 place-items-center rounded-full border-2 text-base font-bold transition-transform",
        step.state === "done" &&
          "border-teal bg-teal/20 text-teal shadow-[0_0_18px_-4px_var(--color-teal)]",
        step.state === "current" &&
          "border-violet bg-violet/25 text-ink shadow-[0_0_28px_-2px_var(--color-violet)]",
        step.state === "upcoming" && "border-line-strong bg-surface text-ink-muted",
        step.state === "removed" && "border-dashed border-line bg-surface/60 text-ink-muted/60",
      )}
    >
      {step.state === "current" && (
        <span
          aria-hidden
          className="absolute -inset-1.5 rounded-full border border-violet/60 motion-safe:animate-ping"
        />
      )}
      {step.state === "done" ? (
        <CheckIcon aria-hidden className="size-6" strokeWidth={3} />
      ) : step.state === "removed" ? (
        <LockIcon aria-hidden className="size-5" />
      ) : (
        formatNumber(step.position, {}, settings)
      )}
    </span>
  );

  const label = (
    <span
      className={cn(
        "flex min-w-0 flex-col gap-1",
        labelLeft ? "items-end text-right" : "items-start text-left",
      )}
    >
      <span
        className={cn(
          "line-clamp-2 text-sm font-semibold",
          step.state === "upcoming" || step.state === "removed" ? "text-ink-soft" : "text-ink",
          step.state === "current" && "text-ink",
        )}
      >
        {title}
      </span>
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-xs font-semibold",
          unlock ? "bg-teal/15 text-teal" : "bg-gold/15 text-gold",
          (step.state === "upcoming" || step.state === "removed") && "opacity-70",
        )}
      >
        {chip}
      </span>
      {step.state === "removed" && <span className="text-xs text-ink-muted">{t("removed")}</span>}
    </span>
  );

  const content = (
    <>
      {labelLeft && label}
      {node}
      {!labelLeft && label}
    </>
  );

  // The node sits on the line; the label fills the half of the row beside it.
  const style = labelLeft
    ? { right: `${100 - x}%`, top: y, transform: "translate(28px, -50%)" }
    : { left: `${x}%`, top: y, transform: "translate(-28px, -50%)" };
  const className = cn(
    "absolute flex max-w-[calc(72%+28px)] items-center gap-3 rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
    step.state === "upcoming" && "opacity-80",
    step.state === "removed" && "opacity-60",
  );

  if (!step.milestoneId) {
    return (
      <div className={className} style={style}>
        {content}
      </div>
    );
  }
  return (
    <Link
      href={`/app/milniky/${step.milestoneId}`}
      aria-label={t("open", { milestone: title, state: t(`states.${step.state}`) })}
      className={cn(className, "group")}
      style={style}
    >
      {content}
    </Link>
  );
}
