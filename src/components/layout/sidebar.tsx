"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { LockIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { isActivePath } from "./nav-items";
import { useNavItems, type NavItemState } from "./use-nav";
import { LockedSectionPopover } from "./lock-hint";
import { Logo } from "./logo";

/** 240 px with labels from 1024 px, icon rail from 768 px, hidden on phones. */
export function Sidebar() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const { items } = useNavItems();

  return (
    <aside className="fixed inset-y-0 left-0 z-nav hidden w-[calc(--spacing(19)+env(safe-area-inset-left))] flex-col border-r border-line/70 bg-sidebar/85 pl-[env(safe-area-inset-left)] backdrop-blur-xl md:flex lg:w-[calc(--spacing(60)+env(safe-area-inset-left))]">
      <Link
        href="/app"
        className="flex h-18 shrink-0 items-center justify-center gap-3 px-5 lg:justify-start"
      >
        <Logo />
        <span className="hidden text-lg font-bold tracking-tight text-ink lg:inline">
          {APP_NAME}
        </span>
      </Link>

      <nav aria-label={t("label")} className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
        {items.map((item) =>
          item.locked ? (
            <LockedNavItem key={item.key} item={item} />
          ) : (
            <Link
              key={item.key}
              href={item.href}
              data-tour={`nav-${item.key}`}
              aria-current={isActivePath(pathname, item.href) ? "page" : undefined}
              aria-label={t(item.key)}
              title={t(item.key)}
              className={cn(
                "group relative flex h-11 items-center justify-center gap-3 rounded-xl px-3 text-sm font-medium outline-none lg:justify-start",
                "focus-visible:ring-3 focus-visible:ring-ring/50",
                isActivePath(pathname, item.href) ? "text-ink" : "text-ink-soft hover:text-ink",
              )}
            >
              {isActivePath(pathname, item.href) && (
                <motion.span
                  layoutId="sidebar-active"
                  transition={
                    reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }
                  }
                  className="absolute inset-0 rounded-xl border border-violet/60 bg-violet/20 shadow-glow-strong"
                />
              )}
              {!isActivePath(pathname, item.href) && item.fresh && (
                <span className="absolute inset-0 rounded-xl border border-teal/50 bg-teal/10 shadow-[0_0_18px_-4px_var(--color-teal)]" />
              )}
              {!isActivePath(pathname, item.href) && (
                <span className="absolute inset-0 rounded-xl bg-surface opacity-0 transition-opacity group-hover:opacity-100" />
              )}
              <span className="relative shrink-0">
                <item.icon
                  aria-hidden
                  className={cn(
                    "size-5",
                    isActivePath(pathname, item.href) ? "text-violet" : undefined,
                  )}
                />
                {item.fresh && <FreshDot />}
              </span>
              <span className="relative hidden truncate lg:inline">{t(item.key)}</span>
              {item.fresh && <span className="sr-only">{t("justUnlocked")}</span>}
            </Link>
          ),
        )}
      </nav>
    </aside>
  );
}

/** Dimmed, not a link: a card explains what the section does and what unlocks it. */
function LockedNavItem({ item }: { item: NavItemState }) {
  const t = useTranslations("nav");
  return (
    <LockedSectionPopover
      item={item}
      side="right"
      trigger={
        <button
          type="button"
          aria-label={t("lockedLabel", { section: t(item.key) })}
          data-tour={`nav-${item.key}`}
          className="group relative flex h-11 cursor-pointer items-center justify-center gap-3 rounded-xl px-3 text-sm font-medium text-ink-muted/60 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 lg:justify-start"
        >
          <LockIcon aria-hidden className="relative size-5 shrink-0" />
          <span className="relative hidden truncate lg:inline">{t(item.key)}</span>
        </button>
      }
    />
  );
}

/** A section just unlocked and not opened yet. */
function FreshDot() {
  const reduceMotion = useReducedMotion();
  return (
    <span
      aria-hidden
      className={cn(
        "absolute -top-0.5 -right-0.5 size-2 rounded-full bg-teal shadow-[0_0_8px_var(--color-teal)]",
        !reduceMotion && "motion-safe:animate-pulse",
      )}
    />
  );
}

