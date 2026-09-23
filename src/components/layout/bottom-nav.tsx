"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  EllipsisIcon,
  LogOutIcon,
  SettingsIcon,
  UserRoundIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useSignOut } from "@/features/account/queries";
import { cn } from "@/lib/utils";
import { bottomNavKeys, isActivePath, navItems } from "./nav-items";

const primaryItems = navItems.filter((item) => bottomNavKeys.includes(item.key));
const moreItems = navItems.filter((item) => !bottomNavKeys.includes(item.key));
const accountItems = [
  { key: "profile", href: "/profile", icon: UserRoundIcon },
  { key: "settings", href: "/settings", icon: SettingsIcon },
] as const;

/**
 * Floating glass bar for phones. It stops short of the right edge:
 * the bottom-right corner belongs to Jarvis.
 */
export function BottomNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const signOut = useSignOut();
  const moreActive = [...moreItems, ...accountItems].some((item) =>
    isActivePath(pathname, item.href),
  );

  return (
    <>
      <nav
        aria-label={t("label")}
        className="fixed bottom-[calc(12px+env(safe-area-inset-bottom))] left-4 z-40 flex h-16 right-[calc(16px+64px+8px)] items-stretch justify-around rounded-2xl border border-line/70 bg-surface/60 px-0.5 shadow-popover backdrop-blur-xl md:hidden"
      >
        {primaryItems.map(({ key, href, icon }) => (
          <BottomNavLink
            key={key}
            href={href}
            icon={icon}
            label={t(key)}
            active={isActivePath(pathname, href)}
          />
        ))}
        <BottomNavButton
          icon={EllipsisIcon}
          label={t("more")}
          active={moreActive}
          onClick={() => setMoreOpen(true)}
        />
      </nav>

      <BottomSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        title={t("more")}
        closeLabel={t("close")}
        className="md:hidden"
      >
        <ul className="grid grid-cols-2 gap-3">
          {moreItems.map(({ key, href, icon: Icon }) => {
            const active = isActivePath(pathname, href);
            return (
              <li key={key}>
                <Link
                  href={href}
                  onClick={() => setMoreOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-20 flex-col justify-between gap-3 rounded-card border p-4 text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    active
                      ? "border-violet/60 bg-violet/20 text-ink shadow-glow-strong"
                      : "border-line bg-canvas-deep/60 text-ink-soft",
                  )}
                >
                  <Icon aria-hidden className={cn("size-5", active && "text-violet")} />
                  {t(key)}
                </Link>
              </li>
            );
          })}
        </ul>

        <ul className="mt-4 flex flex-col gap-1 border-t border-line pt-3">
          {accountItems.map(({ key, href, icon: Icon }) => {
            const active = isActivePath(pathname, href);
            return (
              <li key={key}>
                <Link
                  href={href}
                  onClick={() => setMoreOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-12 items-center gap-3 rounded-xl px-3 text-[15px] font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    active ? "bg-violet/15 text-ink" : "text-ink-soft",
                  )}
                >
                  <Icon aria-hidden className={cn("size-5", active && "text-violet")} />
                  {t(key)}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={signOut}
              className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-[15px] font-medium text-pink outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <LogOutIcon aria-hidden className="size-5" />
              {t("signOut")}
            </button>
          </li>
        </ul>
      </BottomSheet>
    </>
  );
}

type ItemProps = { icon: LucideIcon; label: string; active: boolean };

function ItemBody({ icon: Icon, label, active }: ItemProps) {
  const reduceMotion = useReducedMotion();
  return (
    <>
      {active && (
        <motion.span
          layoutId="bottom-nav-active"
          transition={
            reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }
          }
          className="absolute inset-x-0.5 inset-y-1.5 rounded-xl border border-violet/60 bg-violet/20 shadow-glow-strong"
        />
      )}
      <Icon aria-hidden className={cn("relative size-5", active ? "text-violet" : undefined)} />
      <span className="relative max-w-full truncate text-[10px] leading-none font-medium tracking-tight">
        {label}
      </span>
    </>
  );
}

const itemClass = (active: boolean) =>
  cn(
    "relative flex min-w-11 flex-1 flex-col items-center justify-center gap-1 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
    active ? "text-ink" : "text-ink-muted",
  );

function BottomNavLink({ href, ...props }: ItemProps & { href: string }) {
  return (
    <Link
      href={href}
      aria-current={props.active ? "page" : undefined}
      className={itemClass(props.active)}
    >
      <ItemBody {...props} />
    </Link>
  );
}

function BottomNavButton({ onClick, ...props }: ItemProps & { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      className={itemClass(props.active)}
    >
      <ItemBody {...props} />
    </button>
  );
}
