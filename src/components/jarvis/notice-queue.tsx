"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { dotWindow, swipeStep } from "@/features/jarvis/notice-queue";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useReducedMotionSafe } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

/** Arrow keys move through the queue while the card has focus, but never out of a text field. */
export function queueKeyDown(onPrevious: () => void, onNext: () => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable='true']")) return;
    event.preventDefault();
    if (event.key === "ArrowLeft") onPrevious();
    else onNext();
  };
}

/**
 * "2 of 5" with ‹ › and up to five dots, for the header of a card that shows
 * one notice of a queue. Nothing for a single notice.
 */
export function NoticePager({
  index,
  total,
  onPrevious,
  onNext,
  className,
}: {
  index: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
  className?: string;
}) {
  const t = useTranslations("jarvis.queue");
  const settings = useFormatSettings();
  if (total < 2) return null;
  const { start, end } = dotWindow(index, total);
  const position = t("position", {
    current: formatNumber(index + 1, {}, settings),
    total: formatNumber(total, {}, settings),
  });
  const arrow =
    "grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-soft outline-none transition-colors hover:bg-surface-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-teal/50 mouse:size-8";

  return (
    <div className={cn("flex shrink-0 items-center", className)}>
      <button type="button" onClick={onPrevious} aria-label={t("previous")} className={arrow}>
        <ChevronLeftIcon aria-hidden className="size-4" />
      </button>
      <div className="flex min-w-12 flex-col items-center gap-1">
        <span
          data-testid="notice-position"
          className="text-xs whitespace-nowrap text-ink-muted tabular-nums"
        >
          {position}
        </span>
        <span aria-hidden className="flex items-center gap-1">
          {Array.from({ length: end - start }, (_, offset) => (
            <span
              key={start + offset}
              className={cn(
                "size-1.5 rounded-full transition-colors",
                start + offset === index ? "bg-teal" : "bg-line-strong",
              )}
            />
          ))}
        </span>
      </div>
      <button type="button" onClick={onNext} aria-label={t("next")} className={arrow}>
        <ChevronRightIcon aria-hidden className="size-4" />
      </button>
    </div>
  );
}

/**
 * The notice on screen, swapped with a short slide (a fade with reduced
 * motion) when the card moves. On a phone it follows a sideways swipe.
 */
export function NoticeSlide({
  itemKey,
  direction,
  swipe,
  onPrevious,
  onNext,
  className,
  children,
}: {
  itemKey: string;
  direction: 1 | -1;
  /** Swipe to the sides (phones, more than one notice). */
  swipe: boolean;
  onPrevious: () => void;
  onNext: () => void;
  className?: string;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotionSafe();
  const offset = reduceMotion ? 0 : 24;

  const onDragEnd = (_event: unknown, info: PanInfo) => {
    const step = swipeStep(info.offset.x, info.velocity.x);
    if (step === 1) onNext();
    else if (step === -1) onPrevious();
  };

  return (
    <AnimatePresence mode="wait" initial={false} custom={direction}>
      <motion.div
        key={itemKey}
        custom={direction}
        variants={{
          enter: (towards: 1 | -1) => ({ opacity: 0, x: towards * offset }),
          center: { opacity: 1, x: 0 },
          exit: (towards: 1 | -1) => ({ opacity: 0, x: -towards * offset }),
        }}
        initial="enter"
        animate="center"
        exit="exit"
        transition={{ duration: reduceMotion ? 0.08 : 0.16, ease: "easeOut" }}
        drag={swipe ? "x" : false}
        dragDirectionLock
        dragSnapToOrigin
        dragElastic={0.4}
        dragConstraints={{ left: 0, right: 0 }}
        onDragEnd={swipe ? onDragEnd : undefined}
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
