"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView } from "framer-motion";
import { CheckIcon, GiftIcon, LockIcon, RotateCcwIcon, TrophyIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { GAME_SCHEDULE, stageReached, type GameStage } from "./game-schedule";
import { useReducedMotionSafe } from "./scroll-effects";

const TASKS = ["task1", "task2", "task3"] as const;

/**
 * 5. The game: the words on the right, and on the left a milestone card
 * that completes itself once, with a small celebration. The card is the one
 * thing here that moves, because it shows what finishing a step feels like.
 */
export function GameShowcase({ id }: { id: string }) {
  const t = useTranslations("marketing.home.game");
  return (
    <section
      id={id}
      aria-labelledby="game-title"
      className="mx-auto mt-28 w-full max-w-6xl scroll-mt-24 px-4 md:mt-44 md:px-8"
    >
      <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-10">
        <div className="order-2 flex flex-col gap-6 lg:order-1 lg:col-span-6 lg:col-start-7">
          <h2
            id="game-title"
            className="font-display text-[2.35rem] leading-[1] font-semibold tracking-[-0.03em] text-balance text-ink md:text-5xl"
          >
            {t("title")}
          </h2>
          <p className="max-w-[36rem] text-lg leading-relaxed text-ink-soft">{t("text1")}</p>
          <p className="max-w-[36rem] text-lg leading-relaxed text-ink-soft">
            {t("text2", { appName: APP_NAME })}
          </p>
          <p className="max-w-[36rem] border-l-2 border-violet pl-4 text-ink-muted">
            {t("toolMode", { appName: APP_NAME })}
          </p>
        </div>
        <div className="order-1 lg:order-2 lg:col-span-5 lg:col-start-1 lg:row-start-1">
          <MilestoneDemo />
        </div>
      </div>
    </section>
  );
}

function MilestoneDemo() {
  const t = useTranslations("marketing.home.game.demo");
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inView = useInView(ref, { once: true, margin: "-25% 0px" });
  const reduce = useReducedMotionSafe();
  const [stage, setStage] = useState<GameStage>("waiting");
  const timers = useRef<number[]>([]);

  const play = useCallback(() => {
    timers.current.forEach(window.clearTimeout);
    if (reduce) {
      setStage("done");
      return;
    }
    setStage("waiting");
    timers.current = (Object.entries(GAME_SCHEDULE) as [GameStage, number][]).map(([next, at]) =>
      window.setTimeout(() => setStage(next), at),
    );
  }, [reduce]);

  useEffect(() => {
    if (inView) play();
  }, [inView, play]);

  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  useEffect(() => {
    if (stage !== "celebrating" || reduce) return;
    let cancelled = false;
    void import("canvas-confetti").then(({ default: confetti }) => {
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      const fire = confetti.create(canvas, { resize: true, disableForReducedMotion: true });
      const styles = getComputedStyle(document.documentElement);
      const colors = ["--color-gold", "--color-violet", "--color-teal"]
        .map((token) => styles.getPropertyValue(token).trim())
        .filter(Boolean);
      void fire({
        particleCount: 70,
        spread: 75,
        startVelocity: 32,
        origin: { x: 0.5, y: 0.45 },
        colors,
        scalar: 0.8,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [stage, reduce]);

  const ticked = stageReached(stage, "ticked");
  const unlocked = stageReached(stage, "unlocked");
  const pressed = stageReached(stage, "pressed");
  const celebrating = stageReached(stage, "celebrating");
  const doneTasks = ticked ? 3 : 2;

  return (
    <div ref={ref} className="relative mx-auto w-full max-w-[26rem] lg:mx-0 lg:max-w-none">
      <article
        aria-label={t("label")}
        className={cn(
          "relative flex flex-col gap-5 overflow-hidden rounded-card border bg-surface p-6 shadow-popover transition-colors duration-500",
          celebrating ? "border-gold" : "border-line-strong/70",
        )}
      >
        <header className="flex flex-col gap-2">
          <p className="micro-label">{t("chapter")}</p>
          <h3 className="text-2xl font-bold tracking-tight text-ink">{t("title")}</h3>
          <p className="inline-flex items-center gap-2 text-sm text-gold">
            <GiftIcon aria-hidden className="size-4" />
            {t("reward")}
          </p>
        </header>

        <ul className="flex flex-col gap-2">
          {TASKS.map((task, index) => {
            const done = index < 2 || ticked;
            return (
              <li
                key={task}
                className="flex min-h-11 items-center gap-3 rounded-xl bg-canvas-deep/60 px-3"
              >
                <span
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-md border-2 transition-colors duration-300",
                    done ? "border-teal bg-teal text-canvas" : "border-line-strong",
                  )}
                >
                  <AnimatePresence initial={false}>
                    {done && (
                      <motion.span
                        key="check"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 500, damping: 22 }}
                      >
                        <CheckIcon aria-hidden className="size-4" strokeWidth={3} />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
                <span
                  className={cn(
                    "text-sm transition-colors",
                    done ? "text-ink-muted line-through" : "text-ink",
                  )}
                >
                  {t(task)}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-col gap-2">
          <div className="flex justify-between text-sm">
            <span className="text-ink-muted">{t("progress")}</span>
            <span className="font-semibold text-ink tabular-nums">
              {t("progressValue", { done: String(doneTasks), total: "3" })}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-line">
            <motion.div
              className="h-full origin-left rounded-full bg-teal"
              initial={false}
              animate={{ scaleX: doneTasks / 3 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
        </div>

        <motion.span
          aria-hidden
          animate={pressed && !celebrating ? { scale: 0.96 } : { scale: 1 }}
          transition={{ duration: 0.15 }}
          className={cn(
            "flex h-12 items-center justify-center gap-2 rounded-xl text-base font-semibold transition-[background-color,color,box-shadow,opacity] duration-500",
            unlocked
              ? "bg-violet text-white"
              : "border border-line bg-surface-hover text-ink-muted opacity-70",
          )}
        >
          {unlocked ? <TrophyIcon className="size-4" /> : <LockIcon className="size-4" />}
          {unlocked ? t("complete") : t("remaining")}
        </motion.span>

        <AnimatePresence>
          {celebrating && (
            <motion.div
              key="celebration"
              role="status"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface/92 p-6 text-center backdrop-blur-sm"
            >
              <span className="grid size-16 place-items-center rounded-full border border-gold/60 bg-gold/15">
                <TrophyIcon aria-hidden className="size-8 text-gold" />
              </span>
              <p className="text-2xl font-bold text-ink">{t("celebrationTitle")}</p>
              <p className="text-ink-soft">{t("celebrationReward")}</p>
              <motion.span
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="rounded-full border border-gold/50 bg-gold/15 px-4 py-1 font-bold text-gold tabular-nums"
              >
                {t("xp")}
              </motion.span>
              {stage === "done" && (
                <motion.button
                  type="button"
                  onClick={play}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="mt-2 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-4 text-sm font-medium text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <RotateCcwIcon aria-hidden className="size-4" />
                  {t("replay")}
                </motion.button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Above the celebration card, so the confetti flies over it. */}
        <canvas
          ref={canvasRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 size-full"
        />
      </article>
    </div>
  );
}
