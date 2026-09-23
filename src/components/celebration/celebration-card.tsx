"use client";

import { useEffect, useRef } from "react";
import { Dialog } from "@base-ui/react/dialog";
import confetti from "canvas-confetti";
import { motion, useReducedMotion, type Transition } from "framer-motion";
import { TrophyIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatNumber } from "@/lib/format";
import { isSoundEnabled } from "@/lib/sound-preference";
import { playCelebrationSound } from "./celebration-sound";
import type { CelebrationOptions } from "./celebration-provider";

type CelebrationCardProps = CelebrationOptions & { onContinue: () => void };

/** Seconds after mount at which each beat of the sequence starts. */
const BEAT = { card: 0.05, trophy: 0.2, confetti: 0.3, text: 0.4, bar: 0.55, xp: 1.1 } as const;

export function CelebrationCard({ title, subtitle, xp, onContinue }: CelebrationCardProps) {
  const t = useTranslations("celebration");
  const reduceMotion = useReducedMotion() ?? false;
  const cardRef = useRef<HTMLDivElement>(null);
  const soundPlayed = useRef(false);

  useEffect(() => {
    // Guarded so Strict Mode's double effect run does not play it twice.
    if (!soundPlayed.current && isSoundEnabled()) playCelebrationSound();
    soundPlayed.current = true;
    if (reduceMotion) return;

    const timers = [
      setTimeout(() => fireConfetti(cardRef.current, "--color-gold", 60), BEAT.confetti * 1000),
      setTimeout(
        () => fireConfetti(cardRef.current, "--color-violet", 120),
        (BEAT.confetti + 0.18) * 1000,
      ),
    ];
    return () => timers.forEach(clearTimeout);
  }, [reduceMotion]);

  const spring = (delay: number, bounce = 0.35): Transition =>
    reduceMotion ? { duration: 0.15, delay: 0 } : { type: "spring", bounce, duration: 0.6, delay };
  const fadeUp = (delay: number) => ({
    initial: { opacity: 0, y: reduceMotion ? 0 : 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3, delay: reduceMotion ? 0 : delay },
  });

  return (
    <motion.div
      ref={cardRef}
      initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={spring(BEAT.card, 0.3)}
      className="relative flex w-full max-w-sm flex-col items-center gap-5 overflow-hidden rounded-3xl border-2 border-gold bg-surface px-6 pt-8 pb-6 text-center shadow-[0_0_40px_-6px_color-mix(in_oklab,var(--color-gold)_65%,transparent),inset_0_0_30px_-16px_var(--color-gold)]"
    >
      {/* Trophy with slowly turning rays behind it */}
      <div className="relative grid size-32 place-items-center">
        <motion.div
          aria-hidden
          className="absolute -inset-16"
          style={{
            background:
              "repeating-conic-gradient(from 0deg, color-mix(in oklab, var(--color-gold) 30%, transparent) 0deg 9deg, transparent 9deg 30deg)",
            maskImage: "radial-gradient(circle, black 20%, transparent 68%)",
            WebkitMaskImage: "radial-gradient(circle, black 20%, transparent 68%)",
          }}
          initial={{ opacity: 0 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, rotate: 360 }}
          transition={{
            opacity: { duration: 0.5, delay: BEAT.trophy },
            rotate: { duration: 24, ease: "linear", repeat: Infinity },
          }}
        />
        <motion.div
          initial={{ scale: reduceMotion ? 1 : 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={spring(BEAT.trophy, 0.55)}
          className="relative grid size-28 place-items-center rounded-full border border-gold/60 bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-gold)_35%,transparent)_0%,color-mix(in_oklab,var(--color-gold)_8%,transparent)_70%)] shadow-[0_0_48px_-4px_var(--color-gold)]"
        >
          <TrophyIcon
            aria-hidden
            className="size-14 text-gold drop-shadow-[0_0_12px_var(--color-gold)]"
            strokeWidth={1.75}
          />
        </motion.div>
      </div>

      <div className="relative flex flex-col gap-2">
        <Dialog.Title
          render={<motion.h2 {...fadeUp(BEAT.text)} />}
          className="text-[32px] leading-tight font-bold tracking-tight text-gold text-balance"
        >
          {title}
        </Dialog.Title>
        {subtitle && (
          <Dialog.Description
            render={<motion.p {...fadeUp(BEAT.text + 0.08)} />}
            className="text-base text-ink text-balance"
          >
            {subtitle}
          </Dialog.Description>
        )}
      </div>

      <div
        role="progressbar"
        aria-label={t("progress")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={100}
        className="relative h-2.5 w-full overflow-hidden rounded-full bg-line/60"
      >
        <motion.div
          className="h-full rounded-full bg-teal shadow-[0_0_12px_var(--color-teal)]"
          initial={{ width: reduceMotion ? "100%" : "0%" }}
          animate={{ width: "100%" }}
          transition={{ duration: 1, delay: BEAT.bar, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>

      {xp ? (
        <motion.span
          initial={{ scale: reduceMotion ? 1 : 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={spring(BEAT.xp, 0.6)}
          className="inline-flex h-9 items-center rounded-full border border-gold/50 bg-gold/15 px-4 text-base font-bold text-gold tabular-nums shadow-[0_0_20px_-6px_var(--color-gold)]"
        >
          {t("xp", { xp: formatNumber(xp) })}
        </motion.span>
      ) : null}

      <motion.button
        {...fadeUp(BEAT.text + 0.2)}
        type="button"
        autoFocus
        onClick={onContinue}
        className="h-12 w-full cursor-pointer rounded-xl bg-violet text-base font-semibold text-ink shadow-glow outline-none transition-[background-color,box-shadow] hover:bg-violet/90 hover:shadow-glow-strong focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {t("continue")}
      </motion.button>
    </motion.div>
  );
}

function fireConfetti(card: HTMLElement | null, colorToken: string, angle: number) {
  const rect = card?.getBoundingClientRect();
  const x = rect ? (rect.left + rect.width / 2) / window.innerWidth : 0.5;
  const y = rect ? (rect.top + rect.height / 2) / window.innerHeight : 0.5;
  const color = getComputedStyle(document.documentElement).getPropertyValue(colorToken).trim();

  void confetti({
    origin: { x, y },
    angle,
    spread: 140,
    particleCount: 110,
    startVelocity: 55,
    gravity: 0.9,
    ticks: 260,
    scalar: 1.05,
    zIndex: 70,
    colors: color ? [color] : undefined,
    disableForReducedMotion: true,
  });
}
