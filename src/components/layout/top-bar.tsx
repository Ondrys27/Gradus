"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { FlameIcon, SearchIcon, SparklesIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useXpSummary } from "@/features/gamification/queries";
import { useAnimationsEnabled } from "@/lib/animation-preference";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { levelForXp } from "@/lib/xp";
import { AccountMenu } from "./account-menu";
import { Logo } from "./sidebar";

/** 72 px bar above the content column. On phones search collapses behind a magnifier. */
export function TopBar() {
  const t = useTranslations("topBar");
  const [searchOpen, setSearchOpen] = useState(false);
  const osReducedMotion = useReducedMotion();
  const animationsEnabled = useAnimationsEnabled();
  const reduceMotion = osReducedMotion || !animationsEnabled;
  const settings = useFormatSettings();
  const summary = useXpSummary();
  const streakDays = summary.data?.streak ?? 0;
  const level = levelForXp(summary.data?.totalXp ?? 0);
  const streakLabel = t("streak.long", {
    count: streakDays,
    days: formatNumber(streakDays, {}, settings),
  });
  const levelLabel = t("level.long", { level: formatNumber(level, {}, settings) });

  // A short pulse whenever XP moves the pills, so a gain is felt even when unwatched.
  const [pulse, setPulse] = useState<"streak" | "level" | null>(null);
  const previous = useRef({ streak: streakDays, level });
  useEffect(() => {
    if (!summary.data) return;
    if (level !== previous.current.level) setPulse("level");
    else if (streakDays !== previous.current.streak) setPulse("streak");
    previous.current = { streak: streakDays, level };
  }, [summary.data, streakDays, level]);
  useEffect(() => {
    if (!pulse) return;
    const timer = setTimeout(() => setPulse(null), 700);
    return () => clearTimeout(timer);
  }, [pulse]);

  return (
    <header className="sticky top-0 z-30 border-b border-line/50 bg-canvas/70 backdrop-blur-xl">
      <div className="relative flex h-18 items-center gap-2 px-4 md:gap-4 md:px-8">
        <Link
          href="/dashboard"
          aria-label={t("home")}
          className="grid size-11 shrink-0 place-items-center rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:hidden"
        >
          <Logo />
        </Link>

        <SearchField className="hidden max-w-md flex-1 md:flex" />
        <div className="flex-1 md:hidden" />

        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          aria-label={t("search.open")}
          className="grid size-11 shrink-0 place-items-center rounded-full text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 md:hidden"
        >
          <SearchIcon aria-hidden className="size-5" />
        </button>

        <div className="flex shrink-0 items-center gap-2 md:ml-auto">
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
          <AccountMenu />
        </div>

        <AnimatePresence>
          {searchOpen && (
            <motion.div
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 flex items-center gap-2 bg-canvas px-4 md:hidden"
            >
              <SearchField autoFocus className="flex-1" />
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                aria-label={t("search.close")}
                className="grid size-11 shrink-0 place-items-center rounded-full text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <XIcon aria-hidden className="size-5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}

function SearchField({ className, autoFocus }: { className?: string; autoFocus?: boolean }) {
  const t = useTranslations("topBar.search");

  return (
    <form role="search" onSubmit={(e) => e.preventDefault()} className={cn("relative", className)}>
      <SearchIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-muted"
      />
      <input
        type="search"
        autoFocus={autoFocus}
        aria-label={t("label")}
        placeholder={t("placeholder")}
        className="pl-10"
      />
    </form>
  );
}
