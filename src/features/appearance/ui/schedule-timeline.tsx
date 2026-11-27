"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslations } from "next-intl";
import { timeOfMinutes } from "@/features/scheduler/zoned";
import { formatIsoTime } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { moveStart, SNAP_MINUTES, type ScheduleBlock } from "../schedule";
import type { ThemeRef } from "../theme-ref";
import type { AppearanceView } from "../custom-tokens";
import { themedProps } from "./theme-miniature";

const DAY = 1440;

/**
 * The day as a bar from midnight to midnight: each block a stretch in the
 * colours of its own theme, its start a handle to drag (snapped to 15
 * minutes; arrows ±15, Shift ±60). Before the first start the previous day's
 * last block still holds.
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

  const minuteAt = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return ((clientX - rect.left) / rect.width) * DAY;
  };

  const segments: Array<{ block: ScheduleBlock; from: number; to: number; key: string }> = [];
  const first = blocks[0];
  if (first && first.start > 0) {
    const before = carried ?? blocks[blocks.length - 1];
    segments.push({ block: before, from: 0, to: first.start, key: `carried-${before.id}` });
  }
  blocks.forEach((block, index) => {
    segments.push({ block, from: block.start, to: blocks[index + 1]?.start ?? DAY, key: block.id });
  });

  const onPointerDown = (index: number) => (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    dragging.current = index;
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect(blocks[index].id);
  };
  const onPointerMove = (index: number) => (event: PointerEvent<HTMLButtonElement>) => {
    if (dragging.current !== index) return;
    const next = moveStart(blocks, index, minuteAt(event.clientX));
    if (next !== blocks) onChange(next);
  };
  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    dragging.current = null;
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
    <div className="flex flex-col gap-1.5" data-testid="schedule-timeline">
      <div ref={barRef} className="relative h-14 touch-none rounded-xl border border-line select-none">
        <div className="absolute inset-0 flex overflow-hidden rounded-xl">
          {segments.map((segment) => {
            const view = viewOf(segment.block.theme);
            return (
              <button
                type="button"
                key={segment.key}
                tabIndex={-1}
                aria-hidden
                onClick={() => onSelect(segment.block.id)}
                {...themedProps(view)}
                style={{ ...themedProps(view).style, width: `${((segment.to - segment.from) / DAY) * 100}%` }}
                className={cn(
                  "relative h-full cursor-pointer overflow-hidden border-r border-canvas/40 bg-canvas text-left last:border-r-0",
                  selected === segment.block.id && "ring-2 ring-inset ring-violet",
                )}
              >
                <span className="absolute inset-x-0 bottom-0 h-1.5 bg-linear-to-r from-violet to-teal" />
                <span className="absolute inset-0 bg-linear-to-b from-surface to-canvas opacity-80" />
                <span className="relative block truncate px-2 pt-2 text-xs font-medium text-ink">
                  {segment.block.name}
                </span>
              </button>
            );
          })}
        </div>
        {blocks.map((block, index) => (
          <button
            key={block.id}
            type="button"
            role="slider"
            aria-label={t("handle", { name: block.name })}
            aria-valuemin={0}
            aria-valuemax={DAY - SNAP_MINUTES}
            aria-valuenow={block.start}
            aria-valuetext={formatIsoTime(timeOfMinutes(block.start), format)}
            data-schedule-handle={block.id}
            onPointerDown={onPointerDown(index)}
            onPointerMove={onPointerMove(index)}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown(index)}
            style={{ left: `${(block.start / DAY) * 100}%` }}
            className="absolute top-0 z-10 flex h-full w-11 -translate-x-1/2 cursor-ew-resize items-center justify-center outline-none focus-visible:[&>span]:ring-3 focus-visible:[&>span]:ring-ring/60 mouse:w-6"
          >
            <span className="h-9 w-1.5 rounded-full bg-ink shadow-popover" />
          </button>
        ))}
      </div>
      <div className="relative h-4 text-[11px] text-ink-muted" aria-hidden>
        {[0, 6, 12, 18, 24].map((hour) => (
          <span
            key={hour}
            className={cn(
              "absolute -translate-x-1/2 tabular-nums",
              hour === 0 && "translate-x-0",
              hour === 24 && "-translate-x-full",
            )}
            style={{ left: `${(hour / 24) * 100}%` }}
          >
            {formatIsoTime(timeOfMinutes(hour === 24 ? 0 : hour * 60), format)}
          </span>
        ))}
      </div>
    </div>
  );
}
