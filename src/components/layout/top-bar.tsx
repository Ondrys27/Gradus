"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { FlameIcon, SearchIcon, SparklesIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AccountMenu } from "./account-menu";
import { Logo } from "./sidebar";

type TopBarProps = {
  streakDays: number;
  level: number;
};

/** 72 px bar above the content column. On phones search collapses behind a magnifier. */
export function TopBar({ streakDays, level }: TopBarProps) {
  const t = useTranslations("topBar");
  const [searchOpen, setSearchOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  return (
    <header className="sticky top-0 z-30 border-b border-line/50 bg-canvas/70 backdrop-blur-xl">
      <div className="relative flex h-18 items-center gap-2 px-4 md:gap-4 md:px-8">
        <Link href="/dashboard" aria-label={t("home")} className="flex items-center md:hidden">
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
          <span
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-3 text-sm font-semibold text-gold shadow-[0_0_18px_-6px_var(--color-gold)]"
            title={t("streak.long", { count: streakDays })}
          >
            <FlameIcon aria-hidden className="size-4" />
            <span className="tabular-nums">
              <span aria-hidden className="lg:hidden">
                {formatNumber(streakDays)}
              </span>
              <span className="hidden lg:inline">{t("streak.long", { count: streakDays })}</span>
            </span>
            <span className="sr-only lg:hidden">{t("streak.long", { count: streakDays })}</span>
          </span>
          <span
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-teal/40 bg-teal/10 px-3 text-sm font-semibold text-teal shadow-[0_0_18px_-6px_var(--color-teal)]"
            title={t("level.long", { level })}
          >
            <SparklesIcon aria-hidden className="size-4" />
            <span className="tabular-nums">
              <span aria-hidden className="lg:hidden">
                {formatNumber(level)}
              </span>
              <span className="hidden lg:inline">{t("level.long", { level })}</span>
            </span>
            <span className="sr-only lg:hidden">{t("level.long", { level })}</span>
          </span>
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
