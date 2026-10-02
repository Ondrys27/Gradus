"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { FlameIcon, SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useGameState } from "@/features/game/queries";
import { SearchIconButton, SearchTrigger } from "@/features/search/search-trigger";
import { useAnimationsEnabled } from "@/lib/animation-preference";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { AccountMenu } from "./account-menu";
import { Logo } from "./sidebar";

/**
 * 72 px bar above the content column: search in the middle, streak, level and
 * account on the right. On phones search sits behind a magnifier.
 */
export function TopBar() {
  const t = useTranslations("topBar");
  const osReducedMotion = useReducedMotion();
  const animationsEnabled = useAnimationsEnabled();
  const reduceMotion = osReducedMotion || !animationsEnabled;
  const settings = useFormatSettings();
  const game = useGameState();
  const streakDays = game.data?.streak ?? 0;
  const level = game.data?.level ?? 1;
  // Tool mode shows no XP, level or streak; they stay stored for a return to the game.
  const showGame = game.data?.mode !== "tool";
  const streakLabel = t("streak.long", {
    count: streakDays,
    days: formatNumber(streakDays, {}, settings),
  });
  const levelLabel = t("level.long", { level: formatNumber(level, {}, settings) });

  // A short pulse whenever XP moves the pills, so a gain is felt even when unwatched.
  const [pulse, setPulse] = useState<"streak" | "level" | null>(null);
  const previous = useRef({ streak: streakDays, level });
  useEffect(() => {
    if (!game.data) return;
    if (level !== previous.current.level) setPulse("level");
    else if (streakDays !== previous.current.streak) setPulse("streak");
    previous.current = { streak: streakDays, level };
  }, [game.data, streakDays, level]);
  useEffect(() => {
    if (!pulse) return;
    const timer = setTimeout(() => setPulse(null), 700);
    return () => clearTimeout(timer);
  }, [pulse]);

  return (
    <header className="sticky top-0 z-30 border-b border-line/50 bg-canvas/70 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="relative flex h-18 items-center gap-2 pr-[max(--spacing(4),env(safe-area-inset-right))] pl-[max(--spacing(4),env(safe-area-inset-left))] md:grid md:grid-cols-[1fr_minmax(0,480px)_1fr] md:gap-4 md:pr-[max(--spacing(8),env(safe-area-inset-right))] md:pl-8">
        <Link
          href="/dashboard"
          aria-label={t("home")}
          className="grid size-11 shrink-0 place-items-center rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:hidden"
        >
          <Logo />
        </Link>

        <div aria-hidden className="hidden md:block" />
        <SearchTrigger className="hidden md:flex" />
        <div className="flex-1 md:hidden" />
        <SearchIconButton className="md:hidden" />

        <div className="flex shrink-0 items-center gap-2 md:justify-self-end">
          {showGame && (
            <>
              <motion.span
                animate={{ scale: !reduceMotion && pulse === "streak" ? [1, 1.18, 1] : 1 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-3 text-sm font-semibold text-gold shadow-[0_0_18px_-6px_var(--color-gold)]"
                title={streakLabel}
              >
                <FlameIcon aria-hidden className="size-4" />
                <span className="tabular-nums">
                  <span aria-hidden className="lg:hidden">
                    {formatNumber(streakDays, {}, settings)}
                  </span>
                  <span className="hidden lg:inline">{streakLabel}</span>
                </span>
                <span className="sr-only lg:hidden">{streakLabel}</span>
              </motion.span>
              <motion.span
                animate={{ scale: !reduceMotion && pulse === "level" ? [1, 1.18, 1] : 1 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-teal/40 bg-teal/10 px-3 text-sm font-semibold text-teal shadow-[0_0_18px_-6px_var(--color-teal)]"
                title={levelLabel}
              >
                <SparklesIcon aria-hidden className="size-4" />
                <span className="tabular-nums">
                  <span aria-hidden className="lg:hidden">
                    {formatNumber(level, {}, settings)}
                  </span>
                  <span className="hidden lg:inline">{levelLabel}</span>
                </span>
                <span className="sr-only lg:hidden">{levelLabel}</span>
              </motion.span>
            </>
          )}
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
