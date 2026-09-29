"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { JarvisBot, type JarvisState } from "@/components/jarvis/jarvis-bot";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";

type JarvisButtonProps = {
  state?: JarvisState;
  /** Whether the panel is open; the same button closes it. */
  expanded?: boolean;
  /** Suggestions the user has not seen yet; a gold ring pulses while there are any. */
  attention?: number;
  onClick?: () => void;
};

/**
 * The bottom-right corner belongs to Jarvis alone. On phones the button sits
 * level with the bottom bar, which stops short of it.
 */
export function JarvisButton({
  state = "idle",
  expanded = false,
  attention = 0,
  onClick,
}: JarvisButtonProps) {
  const t = useTranslations("jarvis");
  const reduceMotion = useReducedMotion();
  const settings = useFormatSettings();
  const noticed = attention > 0 && !expanded;
  const label = expanded ? t("close") : t("open");

  return (
    <motion.div
      className="fixed right-[max(16px,env(safe-area-inset-right))] bottom-[calc(12px+env(safe-area-inset-bottom))] z-40 md:right-[max(24px,env(safe-area-inset-right))] md:bottom-[max(24px,env(safe-area-inset-bottom))]"
      animate={reduceMotion ? undefined : { y: [0, -6, 0] }}
      transition={{ duration: 3, ease: "easeInOut", repeat: Infinity }}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={
          noticed
            ? `${label}. ${t("suggestion.unseen", {
                count: attention,
                formatted: formatNumber(attention, {}, settings),
              })}`
            : label
        }
        aria-expanded={expanded}
        className="group relative grid size-16 cursor-pointer place-items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-teal/60"
      >
        {/* Radial glow */}
        <span
          aria-hidden
          className="absolute -inset-4 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-teal)_45%,transparent)_0%,transparent_65%)] opacity-80 transition-opacity group-hover:opacity-100"
        />
        {/* Soft pulsing ring; gold and quicker while Jarvis has something to show */}
        {!reduceMotion && (
          <motion.span
            key={noticed ? "noticed" : "idle"}
            aria-hidden
            className={
              noticed
                ? "absolute inset-0 rounded-full border-[3px] border-gold"
                : "absolute inset-0 rounded-full border-2 border-teal/70"
            }
            animate={{ scale: [1, noticed ? 1.4 : 1.28], opacity: [noticed ? 0.9 : 0.7, 0] }}
            transition={{ duration: noticed ? 1.4 : 2.4, ease: "easeOut", repeat: Infinity }}
          />
        )}
        {noticed && reduceMotion && (
          <span aria-hidden className="absolute -inset-1 rounded-full border-[3px] border-gold" />
        )}
        {noticed && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 z-10 grid size-5 place-items-center rounded-full bg-gold text-[11px] font-bold text-canvas"
          >
            {attention > 9
              ? `${formatNumber(9, {}, settings)}+`
              : formatNumber(attention, {}, settings)}
          </span>
        )}
        <span className="relative grid size-16 place-items-center rounded-full border border-teal/50 bg-canvas-deep shadow-[0_0_28px_-4px_var(--color-teal)] transition-transform group-hover:scale-105 group-active:scale-95">
          <JarvisBot size={44} state={state} />
        </span>
      </button>
    </motion.div>
  );
}
