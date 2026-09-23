"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { JarvisBot, type JarvisState } from "@/components/jarvis/jarvis-bot";

type JarvisButtonProps = {
  state?: JarvisState;
  onClick?: () => void;
};

/**
 * The bottom-right corner belongs to Jarvis alone. On phones the button sits
 * level with the bottom bar, which stops short of it.
 */
export function JarvisButton({ state = "idle", onClick }: JarvisButtonProps) {
  const t = useTranslations("jarvis");
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className="fixed right-4 bottom-[calc(12px+env(safe-area-inset-bottom))] z-40 md:right-6 md:bottom-6"
      animate={reduceMotion ? undefined : { y: [0, -6, 0] }}
      transition={{ duration: 3, ease: "easeInOut", repeat: Infinity }}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={t("open")}
        className="group relative grid size-16 cursor-pointer place-items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-teal/60"
      >
        {/* Radial glow */}
        <span
          aria-hidden
          className="absolute -inset-4 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-teal)_45%,transparent)_0%,transparent_65%)] opacity-80 transition-opacity group-hover:opacity-100"
        />
        {/* Soft pulsing ring */}
        {!reduceMotion && (
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full border-2 border-teal/70"
            animate={{ scale: [1, 1.28], opacity: [0.7, 0] }}
            transition={{ duration: 2.4, ease: "easeOut", repeat: Infinity }}
          />
        )}
        <span className="relative grid size-16 place-items-center rounded-full border border-teal/50 bg-canvas-deep shadow-[0_0_28px_-4px_var(--color-teal)] transition-transform group-hover:scale-105 group-active:scale-95">
          <JarvisBot size={44} state={state} />
        </span>
      </button>
    </motion.div>
  );
}
