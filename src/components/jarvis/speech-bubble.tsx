"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useReducedMotion } from "framer-motion";
import { XIcon } from "lucide-react";
import { useAnimationsEnabled } from "@/lib/animation-preference";
import { cn } from "@/lib/utils";

/** Where the tail points: the side of the bubble Jarvis is on, and which end of it. */
export type BubbleTail = {
  side: "left" | "right" | "top" | "bottom";
  align: "start" | "end";
};

const TAIL_POSITION: Record<BubbleTail["side"], Record<BubbleTail["align"], string>> = {
  left: { start: "-left-2 top-6", end: "-left-2 bottom-6" },
  right: { start: "-right-2 top-6", end: "-right-2 bottom-6" },
  top: { start: "-top-2 left-12", end: "-top-2 right-12" },
  bottom: { start: "-bottom-2 left-12", end: "-bottom-2 right-12" },
};

/** The tail's two visible borders face away from the bubble. */
const TAIL_BORDER: Record<BubbleTail["side"], string> = {
  left: "border-b border-l",
  right: "border-t border-r",
  top: "border-t border-l",
  bottom: "border-b border-r",
};

/**
 * Jarvis's speech bubble: a card in the app's look with a tail towards him
 * and a close cross in the corner. The text is typed out by its owner (see
 * useTypewriter); buttons go in one row underneath.
 */
export function SpeechBubble({
  tail,
  onClose,
  closeLabel,
  className,
  children,
}: {
  tail: BubbleTail;
  onClose?: () => void;
  closeLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative rounded-card border border-line-strong bg-surface p-4 shadow-popover",
        onClose && "pr-12",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute size-4 rotate-45 border-line-strong bg-surface",
          TAIL_BORDER[tail.side],
          TAIL_POSITION[tail.side][tail.align],
        )}
      />
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="absolute top-1 right-1 grid size-11 cursor-pointer place-items-center rounded-full text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-teal/50"
        >
          <XIcon aria-hidden className="size-4" />
        </button>
      )}
      <div className="relative">{children}</div>
    </div>
  );
}

const CHARS_PER_TICK = 2;
const TICK_MS = 24;

/**
 * Types `text` out character by character. With reduced motion (or animations
 * off) the whole text is there at once. `finish()` shows the rest now.
 */
export function useTypewriter(text: string): { shown: string; done: boolean; finish: () => void } {
  const reduceMotion = useReducedMotion();
  const animations = useAnimationsEnabled();
  const instant = Boolean(reduceMotion) || !animations;
  const [state, setState] = useState({ text, count: 0 });
  const count = state.text === text ? state.count : 0;
  if (state.text !== text) setState({ text, count: 0 });

  useEffect(() => {
    if (instant || count >= text.length) return;
    const timer = window.setTimeout(
      () => setState((current) => ({ ...current, count: current.count + CHARS_PER_TICK })),
      TICK_MS,
    );
    return () => window.clearTimeout(timer);
  }, [instant, count, text.length]);

  const done = instant || count >= text.length;
  return {
    shown: done ? text : text.slice(0, count),
    done,
    finish: () => setState({ text, count: text.length }),
  };
}

/** Typed text for the eye; screen readers get the whole sentence at once. */
export function TypedText({ text, className }: { text: string; className?: string }) {
  const { shown } = useTypewriter(text);
  return (
    <p
      className={cn(
        "text-[15px] leading-relaxed break-words whitespace-pre-line text-ink",
        className,
      )}
    >
      <span className="sr-only">{text}</span>
      <span aria-hidden>{shown}</span>
    </p>
  );
}
