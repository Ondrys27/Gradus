"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { isActivePath } from "./nav-items";
import { useNavItems } from "./use-nav";

/** 240 px with labels from 1024 px, icon rail from 768 px, hidden on phones. */
export function Sidebar() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const { items } = useNavItems();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-19 flex-col border-r border-line/70 bg-sidebar/85 backdrop-blur-xl md:flex lg:w-60">
      <Link
        href="/dashboard"
        className="flex h-18 shrink-0 items-center justify-center gap-3 px-5 lg:justify-start"
      >
        <Logo />
        <span className="hidden text-lg font-bold tracking-tight text-ink lg:inline">
          {APP_NAME}
        </span>
      </Link>

      <nav aria-label={t("label")} className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
        {items.map(({ key, href, icon: Icon }) => {
          const active = isActivePath(pathname, href);
          return (
            <Link
              key={key}
              href={href}
              aria-current={active ? "page" : undefined}
              aria-label={t(key)}
              title={t(key)}
              className={cn(
                "group relative flex h-11 items-center justify-center gap-3 rounded-xl px-3 text-sm font-medium outline-none lg:justify-start",
                "focus-visible:ring-3 focus-visible:ring-ring/50",
                active ? "text-ink" : "text-ink-soft hover:text-ink",
              )}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-active"
                  transition={
                    reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }
                  }
                  className="absolute inset-0 rounded-xl border border-violet/60 bg-violet/20 shadow-glow-strong"
                />
              )}
              {!active && (
                <span className="absolute inset-0 rounded-xl bg-surface opacity-0 transition-opacity group-hover:opacity-100" />
              )}
              <Icon
                aria-hidden
                className={cn("relative size-5 shrink-0", active ? "text-violet" : undefined)}
              />
              <span className="relative hidden truncate lg:inline">{t(key)}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-xl bg-linear-to-br from-violet to-teal text-base font-black text-canvas shadow-glow",
        className,
      )}
    >
      {APP_NAME.charAt(0)}
    </span>
  );
}
