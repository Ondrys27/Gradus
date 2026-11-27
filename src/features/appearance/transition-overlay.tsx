"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import type { AppearanceView } from "./custom-tokens";
import type { DayPeriod } from "./schedule";

export type TransitionPlan = {
  id: number;
  name: string;
  caption: string | null;
  period: DayPeriod;
  view: AppearanceView;
  reduced: boolean;
};

/**
 * Timings in ms. `apply`: the app under the overlay changes to the new theme
 * and the wash starts to clear, so the interface is seen to change beneath
 * the name; `leave`: the name goes; `done`: the overlay is removed.
 */
export const TRANSITION_TIMING = {
  full: { apply: 1000, leave: 2000, done: 2700 },
  reduced: { apply: 350, leave: 1150, done: 1500 },
} as const;

type Phase = "enter" | "reveal" | "leave";

/**
 * The character of each time of day, every colour taken from the target
 * theme's own tokens (so a custom theme gets its own dawn or dusk):
 * morning – the light rises from below, the wash climbs up the screen;
 * afternoon – the day crosses from left to right; evening – dusk settles
 * from above onto a deep canvas; night – the same descent, slower and
 * fainter. `edge` is where the single glow sits on the wash: at its leading
 * side, so it is the line of light that moves.
 */
type Character = {
  axis: "x" | "y";
  from: number;
  edge: "top" | "bottom" | "right";
  base: string;
  glow: string;
  glowSize: string;
  enter: number;
  textFrom: { x: number; y: number };
};

const CHARACTER: Record<DayPeriod, Character> = {
  morning: {
    axis: "y",
    from: 100,
    edge: "top",
    base: "var(--color-canvas)",
    glow: "color-mix(in oklab, var(--color-teal) 58%, var(--color-canvas))",
    glowSize: "46%",
    enter: 0.9,
    textFrom: { x: 0, y: 30 },
  },
  afternoon: {
    axis: "x",
    from: -100,
    edge: "right",
    base: "var(--color-canvas)",
    glow: "color-mix(in oklab, var(--color-violet) 48%, var(--color-canvas))",
    glowSize: "34%",
    enter: 0.85,
    textFrom: { x: -26, y: 0 },
  },
  evening: {
    axis: "y",
    from: -100,
    edge: "bottom",
    base: "var(--color-canvas-deep)",
    glow: "color-mix(in oklab, var(--color-violet) 42%, var(--color-canvas-deep))",
    glowSize: "40%",
    enter: 1.0,
    textFrom: { x: 0, y: -30 },
  },
  night: {
    axis: "y",
    from: -100,
    edge: "bottom",
    base: "var(--color-canvas-deep)",
    glow: "color-mix(in oklab, var(--color-ink-muted) 22%, var(--color-canvas-deep))",
    glowSize: "30%",
    enter: 1.15,
    textFrom: { x: 0, y: -22 },
  },
};

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

function washBackground(character: Character): string {
  const to = character.edge === "right" ? "to left" : character.edge === "top" ? "to bottom" : "to top";
  return `linear-gradient(${to}, ${character.glow} 0%, ${character.base} ${character.glowSize})`;
}

/**
 * The moment a block of the day begins (30.6, choreography 30.7): the wash
 * of the new theme sweeps over the screen with one line of light at its
 * edge, the block's name settles in large type with its caption, then the
 * wash clears while the name still stands and the interface is seen already
 * changed beneath it, and the name drifts away. About 2.7 s; a click or Esc
 * skips it (the new theme stays). Reduced motion: the same moments as
 * fades, nothing travels. Only transforms and opacity animate, so a phone
 * keeps every frame.
 */
export function TransitionOverlay({
  plan,
  onApply,
  onDone,
}: {
  plan: TransitionPlan;
  onApply: () => void;
  onDone: (outcome: "played" | "skipped") => void;
}) {
  const t = useTranslations("settings.appearance.transition");
  const timing = plan.reduced ? TRANSITION_TIMING.reduced : TRANSITION_TIMING.full;
  const character = CHARACTER[plan.period];
  const [phase, setPhase] = useState<Phase>("enter");
  const applied = useRef(false);
  const finished = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onApply, onDone });
  callbacks.current = { onApply, onDone };

  useEffect(() => {
    const apply = () => {
      if (applied.current) return;
      applied.current = true;
      callbacks.current.onApply();
    };
    const finish = (outcome: "played" | "skipped") => {
      if (finished.current) return;
      apply();
      finished.current = true;
      callbacks.current.onDone(outcome);
    };
    const timers = [
      window.setTimeout(() => {
        apply();
        setPhase("reveal");
      }, timing.apply),
      window.setTimeout(() => {
        setPhase("leave");
        rootRef.current?.setAttribute("data-leaving", "");
      }, timing.leave),
      window.setTimeout(() => finish("played"), timing.done),
    ];
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      finish("skipped");
    };
    window.addEventListener("keydown", onKey, true);
    const skip = () => finish("skipped");
    const root = rootRef.current;
    root?.addEventListener("pointerdown", skip);
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("keydown", onKey, true);
      root?.removeEventListener("pointerdown", skip);
    };
  }, [timing]);

  const reduced = plan.reduced;
  const leaveSeconds = (timing.done - timing.leave) / 1000;
  const revealSeconds = reduced ? 0.5 : 0.75;
  const washIn = reduced
    ? { opacity: 1 }
    : character.axis === "y"
      ? { y: "0%", opacity: 1 }
      : { x: "0%", opacity: 1 };
  const washStart = reduced
    ? { opacity: 0 }
    : character.axis === "y"
      ? { y: `${character.from}%`, opacity: 1 }
      : { x: `${character.from}%`, opacity: 1 };
  const textDrift = reduced ? { x: 0, y: 0 } : { x: -character.textFrom.x * 0.5, y: -character.textFrom.y * 0.5 };

  return createPortal(
    <div
      ref={rootRef}
      role="status"
      aria-live="polite"
      data-theme-transition=""
      data-period={plan.period}
      data-phase={phase}
      data-theme={plan.view.theme}
      {...plan.view.attrs}
      style={plan.view.style as CSSProperties}
      className="fixed inset-0 z-celebration cursor-pointer overflow-hidden select-none"
    >
      {/* The wash: the new theme's canvas with one line of light at its leading edge. */}
      <motion.div
        aria-hidden
        className="absolute inset-0 will-change-transform"
        style={{ backgroundImage: washBackground(character) }}
        initial={washStart}
        animate={phase === "enter" ? washIn : { ...washIn, opacity: 0 }}
        transition={
          phase === "enter"
            ? reduced
              ? { duration: 0.3 }
              : { duration: character.enter, ease: EASE_OUT }
            : { duration: revealSeconds, ease: "easeInOut" }
        }
      />
      <div className="relative flex h-full flex-col items-center justify-center gap-3 px-6 text-center md:gap-4">
        <motion.p
          className="text-[clamp(52px,12vw,152px)] leading-none font-bold text-ink [text-shadow:0_2px_28px_var(--color-canvas)]"
          style={{ fontFamily: "var(--app-heading-font)" }}
          initial={reduced ? { opacity: 0 } : { opacity: 0, ...character.textFrom, letterSpacing: "0.04em" }}
          animate={
            phase === "leave"
              ? { opacity: 0, ...textDrift, letterSpacing: "-0.02em" }
              : reduced
                ? { opacity: 1 }
                : { opacity: 1, x: 0, y: 0, letterSpacing: "-0.02em" }
          }
          transition={
            phase === "leave"
              ? { duration: leaveSeconds, ease: "easeIn" }
              : reduced
                ? { duration: 0.3 }
                : { delay: 0.3, duration: 0.8, ease: EASE_OUT }
          }
        >
          {plan.name}
        </motion.p>
        {plan.caption && (
          <motion.p
            className="max-w-xl text-lg text-ink-soft [text-shadow:0_1px_18px_var(--color-canvas)] md:text-2xl"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: character.textFrom.y * 0.3 }}
            animate={phase === "leave" ? { opacity: 0, y: textDrift.y * 0.5 } : { opacity: 1, y: 0 }}
            transition={
              phase === "leave"
                ? { duration: leaveSeconds * 0.8, ease: "easeIn" }
                : reduced
                  ? { duration: 0.3, delay: 0.1 }
                  : { delay: 0.62, duration: 0.6, ease: EASE_OUT }
            }
          >
            {plan.caption}
          </motion.p>
        )}
        <span className="sr-only">{t("skipHint")}</span>
      </div>
    </div>,
    document.body,
  );
}
