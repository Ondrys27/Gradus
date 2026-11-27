"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { MoonIcon, SunIcon, SunriseIcon, SunsetIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { timeOfMinutes } from "@/features/scheduler/zoned";
import { formatIsoTime } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { moveStart, periodOf, SNAP_MINUTES, type DayPeriod, type ScheduleBlock } from "../schedule";
import type { ThemeRef } from "../theme-ref";
import type { AppearanceView } from "../custom-tokens";
import { themedProps } from "./theme-miniature";

const DAY = 1440;
const HOUR_TICKS = Array.from({ length: 7 }, (_, index) => (index + 1) * 3);
const LABELS = [0, 6, 12, 18, 24];

const PERIOD_ICON: Record<DayPeriod, typeof SunIcon> = {
  morning: SunriseIcon,
  afternoon: SunIcon,
  evening: SunsetIcon,
  night: MoonIcon,
};

/**
 * The day as a bar from midnight to midnight: each block a stretch painted
 * in its own theme (its surface, its accents as the band on top, its ink for
 * the name), a glyph of its time of day, and its start as a handle to drag.
 * Dragging snaps to 15 minutes and shows the snapped time above the handle;
 * arrows move ±15, Shift ±60. Before the first start the previous day's last
 * block still holds.
 */
export function ScheduleTimeline({
  blocks,
  carried,
  viewOf,
  selected,
  onSelect,
  onChange,
}: {
  blocks: ScheduleBlock[];
  /** The block that holds from midnight until the first start (the previous day's last). */
  carried: ScheduleBlock | null;
  viewOf: (ref: ThemeRef) => AppearanceView;
  selected: string | null;
  onSelect: (id: string) => void;
  onChange: (blocks: ScheduleBlock[]) => void;
}) {
  const t = useTranslations("settings.appearance.schedule");
  const format = useFormatSettings();
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const [active, setActive] = useState<string | null>(null);

  const minuteAt = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return ((clientX - rect.left) / rect.width) * DAY;
  };
  const timeLabel = (minute: number) => formatIsoTime(timeOfMinutes(minute % DAY), format);

  const segments: Array<{ block: ScheduleBlock; from: number; to: number; key: string; carried: boolean }> = [];
  const first = blocks[0];
  if (first && first.start > 0) {
    const before = carried ?? blocks[blocks.length - 1];
    segments.push({ block: before, from: 0, to: first.start, key: `carried-${before.id}`, carried: true });
  }
  blocks.forEach((block, index) => {
    segments.push({ block, from: block.start, to: blocks[index + 1]?.start ?? DAY, key: block.id, carried: false });
  });

  const onPointerDown = (index: number) => (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    dragging.current = index;
    event.currentTarget.setPointerCapture(event.pointerId);
    setActive(blocks[index].id);
    onSelect(blocks[index].id);
  };
  const onPointerMove = (index: number) => (event: PointerEvent<HTMLButtonElement>) => {
    if (dragging.current !== index) return;
    const next = moveStart(blocks, index, minuteAt(event.clientX));
    if (next !== blocks) onChange(next);
  };
  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    dragging.current = null;
    setActive(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 60 : SNAP_MINUTES;
    const delta = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -step : event.key === "ArrowRight" || event.key === "ArrowUp" ? step : 0;
    if (!delta) return;
    event.preventDefault();
    const next = moveStart(blocks, index, blocks[index].start + delta);
    if (next !== blocks) onChange(next);
  };

  return (
    <div className="flex flex-col gap-1.5 pt-7" data-testid="schedule-timeline">
      <div ref={barRef} className="relative h-16 touch-none rounded-2xl select-none md:h-[4.5rem]">
        <div className="absolute inset-0 flex overflow-hidden rounded-2xl border border-line-strong/60 bg-canvas-deep">
          {segments.map((segment) => {
            const view = viewOf(segment.block.theme);
            const Icon = PERIOD_ICON[periodOf(segment.block.start)];
            const width = ((segment.to - segment.from) / DAY) * 100;
            return (
              <button
                type="button"
                key={segment.key}
                tabIndex={-1}
                aria-hidden
                onClick={() => onSelect(segment.block.id)}
                {...themedProps(view)}
                style={{ ...themedProps(view).style, width: `${width}%` }}
                className={cn(
                  "group/segment relative h-full min-w-0 cursor-pointer overflow-hidden text-left transition-[filter] duration-200 motion-reduce:transition-none",
                  "bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--color-violet)_16%,var(--color-surface)),var(--color-canvas))]",
                  segment.carried && "opacity-70",
                  selected === segment.block.id ? "brightness-110" : "hover:brightness-105",
                )}
              >
                {/* The band of the theme's accents along the top. */}
                <span className="absolute inset-x-0 top-0 h-1 bg-linear-to-r from-violet to-teal" />
                <span
                  className={cn(
                    "absolute inset-0 border-y-2 border-transparent transition-colors motion-reduce:transition-none",
                    selected === segment.block.id && "border-b-violet",
                  )}
                />
                <span className="relative flex h-full flex-col justify-end gap-0.5 px-2 pb-1.5 pt-2.5">
                  <span className="flex min-w-0 items-center gap-1 text-xs font-semibold text-ink">
                    <Icon aria-hidden className="size-3.5 shrink-0 text-ink-soft" />
                    <span className="truncate">{segment.block.name}</span>
                  </span>
                  {width >= 12 && (
                    <span className="truncate text-[11px] tabular-nums text-ink-muted">
                      {segment.carried ? t("fromYesterday") : timeLabel(segment.block.start)}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        {HOUR_TICKS.map((hour) => (
          <span
            key={hour}
            aria-hidden
            className={cn("pointer-events-none absolute bottom-0 w-px bg-ink/10", hour % 6 === 0 ? "h-3" : "h-1.5")}
            style={{ left: `${(hour / 24) * 100}%` }}
          />
        ))}
        {blocks.map((block, index) => {
          const lifted = active === block.id;
          return (
            <button
              key={block.id}
              type="button"
              role="slider"
              aria-label={t("handle", { name: block.name })}
              aria-valuemin={0}
              aria-valuemax={DAY - SNAP_MINUTES}
              aria-valuenow={block.start}
              aria-valuetext={timeLabel(block.start)}
              data-schedule-handle={block.id}
              data-dragging={lifted ? "" : undefined}
              onPointerDown={onPointerDown(index)}
              onPointerMove={onPointerMove(index)}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={onKeyDown(index)}
              style={{ left: `${(block.start / DAY) * 100}%` }}
              className="group/handle absolute top-0 z-10 flex h-full w-11 -translate-x-1/2 cursor-ew-resize items-center justify-center outline-none mouse:w-7"
            >
              <span
                className={cn(
                  "h-10 w-1.5 rounded-full bg-ink shadow-popover ring-2 ring-canvas-deep/70 transition-transform duration-150 motion-reduce:transition-none",
                  "group-hover/handle:scale-y-110 group-focus-visible/handle:ring-3 group-focus-visible/handle:ring-ring/70",
                  lifted && "scale-y-110 bg-violet",
                )}
              />
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 rounded-md border border-line-strong bg-surface px-1.5 py-0.5 text-[11px] font-medium tabular-nums whitespace-nowrap text-ink shadow-popover transition-opacity duration-150 motion-reduce:transition-none",
                  lifted ? "opacity-100" : "opacity-0 group-focus-visible/handle:opacity-100",
                )}
              >
                {timeLabel(block.start)}
              </span>
            </button>
          );
        })}
      </div>
      <div className="relative h-4 text-[11px] text-ink-muted" aria-hidden>
        {LABELS.map((hour) => (
          <span
            key={hour}
            className={cn(
              "absolute -translate-x-1/2 tabular-nums",
              hour === 0 && "translate-x-0",
              hour === 24 && "-translate-x-full",
            )}
            style={{ left: `${(hour / 24) * 100}%` }}
          >
            {timeLabel(hour === 24 ? 0 : hour * 60)}
          </span>
        ))}
      </div>
    </div>
  );
}
