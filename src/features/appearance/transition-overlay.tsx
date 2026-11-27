"use client";

import { useEffect, useRef, type CSSProperties } from "react";
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

/** Timings in ms: the new theme washes in, the page changes under it, the overlay leaves. */
export const TRANSITION_TIMING = {
  full: { apply: 950, leave: 1900, done: 2650 },
  reduced: { apply: 250, leave: 1100, done: 1400 },
} as const;

/** Where the colour of the new block spreads from: morning light from below, evening dusk from above. */
const ORIGIN: Record<DayPeriod, string> = {
  morning: "50% 100%",
  afternoon: "0% 50%",
  evening: "50% 0%",
  night: "50% 0%",
};

const WASH: Record<DayPeriod, string> = {
  morning:
    "radial-gradient(120% 90% at 50% 110%, color-mix(in oklab, var(--color-teal) 34%, var(--color-canvas)) 0%, var(--color-canvas) 62%)",
  afternoon:
    "linear-gradient(100deg, color-mix(in oklab, var(--color-violet) 26%, var(--color-canvas)) 0%, var(--color-canvas) 70%)",
  evening:
    "radial-gradient(120% 90% at 50% -10%, color-mix(in oklab, var(--color-violet) 30%, var(--color-canvas-deep)) 0%, var(--color-canvas-deep) 65%)",
  night:
    "radial-gradient(90% 70% at 50% -10%, color-mix(in oklab, var(--color-violet) 16%, var(--color-canvas-deep)) 0%, var(--color-canvas-deep) 70%)",
};

/**
 * The moment a block of the day begins (30.6): the overlay is painted in the
 * new theme, its colour spreads over the screen from one side, the block's
 * name in large type with its caption, the app changes underneath, and it
 * all fades away. Reduced motion: a short fade with the name, nothing moves.
 * A click or Esc skips it (the new theme stays).
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
      window.setTimeout(apply, timing.apply),
      window.setTimeout(() => {
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

  const themed = {
    ...plan.view.style,
    "--transition-leave": `${(timing.done - timing.leave) / 1000}s`,
  } as CSSProperties;

  return createPortal(
    <div
      ref={rootRef}
      role="status"
      aria-live="polite"
      data-theme-transition=""
      data-period={plan.period}
      data-theme={plan.view.theme}
      {...plan.view.attrs}
      style={themed}
      className="fixed inset-0 z-celebration cursor-pointer overflow-hidden transition-opacity duration-(--transition-leave) ease-in data-[leaving]:opacity-0"
    >
      <motion.div
        aria-hidden
        className="absolute inset-0 bg-canvas"
        style={{ backgroundImage: WASH[plan.period] }}
        initial={plan.reduced ? { opacity: 0 } : { clipPath: `circle(0% at ${ORIGIN[plan.period]})` }}
        animate={plan.reduced ? { opacity: 1 } : { clipPath: `circle(150% at ${ORIGIN[plan.period]})` }}
        transition={plan.reduced ? { duration: 0.2 } : { duration: 0.85, ease: [0.22, 1, 0.36, 1] }}
      />
      <div className="relative flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <motion.p
          className="text-[clamp(48px,11vw,128px)] leading-none font-bold tracking-tight text-ink"
          style={{ fontFamily: "var(--app-heading-font)" }}
          initial={plan.reduced ? { opacity: 0 } : { opacity: 0, y: plan.period === "morning" ? 28 : -28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={plan.reduced ? { duration: 0.2 } : { delay: 0.28, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          {plan.name}
        </motion.p>
        {plan.caption && (
          <motion.p
            className="max-w-xl text-lg text-ink-soft md:text-2xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={plan.reduced ? { duration: 0.2 } : { delay: 0.55, duration: 0.5 }}
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
