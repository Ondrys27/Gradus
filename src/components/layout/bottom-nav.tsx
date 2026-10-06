"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  EllipsisIcon,
  LockIcon,
  LogOutIcon,
  SettingsIcon,
  UserRoundIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useSignOut } from "@/features/account/queries";
import { cn } from "@/lib/utils";
import { isActivePath } from "./nav-items";
import { useNavItems, type NavItemState } from "./use-nav";
import { LockedSectionPopover } from "./lock-hint";
const accountItems = [
  { key: "profile", href: "/app/profil", icon: UserRoundIcon },
  { key: "settings", href: "/app/nastaveni", icon: SettingsIcon },
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
  const { primary: primaryItems, more: moreItems } = useNavItems();
  const moreActive = [...moreItems, ...accountItems].some((item) =>
    isActivePath(pathname, item.href),
  );

  return (
    <>
      <nav
        aria-label={t("label")}
        className="fixed right-[calc(max(16px,env(safe-area-inset-right))+64px+8px)] bottom-[calc(12px+env(safe-area-inset-bottom))] left-[max(16px,env(safe-area-inset-left))] z-nav flex h-16 items-stretch justify-around rounded-2xl border border-line/70 bg-surface/60 px-0.5 shadow-popover backdrop-blur-xl md:hidden"
      >
        {primaryItems.map((item) =>
          item.locked ? (
            <LockedBottomNavItem key={item.key} item={item} />
          ) : (
            <BottomNavLink
              key={item.key}
              href={item.href}
              tour={`nav-${item.key}`}
              icon={item.icon}
              label={t(item.key)}
              active={isActivePath(pathname, item.href)}
              fresh={item.fresh}
            />
          ),
        )}
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
          {moreItems.map((item) => {
            const active = isActivePath(pathname, item.href);
            if (item.locked) {
              return (
                <li key={item.key}>
                  <LockedSectionPopover
                    item={item}
                    side="top"
                    onNavigate={() => setMoreOpen(false)}
                    trigger={
                      <button
                        type="button"
                        aria-label={t("lockedLabel", { section: t(item.key) })}
                        className="flex min-h-20 w-full cursor-pointer flex-col justify-between gap-3 rounded-card border border-line bg-canvas-deep/40 p-4 text-left text-sm font-semibold text-ink-muted/60 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <LockIcon aria-hidden className="size-5" />
                        {t(item.key)}
                      </button>
                    }
                  />
                </li>
              );
            }
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex min-h-20 flex-col justify-between gap-3 rounded-card border p-4 text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    active
                      ? "border-violet/60 bg-violet/20 text-ink shadow-glow-strong"
                      : item.fresh
                        ? "border-teal/50 bg-teal/10 text-ink shadow-[0_0_18px_-4px_var(--color-teal)]"
                        : "border-line bg-canvas-deep/60 text-ink-soft",
                  )}
                >
                  <span className="relative inline-block">
                    <item.icon aria-hidden className={cn("size-5", active && "text-violet")} />
                    {item.fresh && (
                      <span
                        aria-hidden
                        className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-teal shadow-[0_0_8px_var(--color-teal)] motion-safe:animate-pulse"
                      />
                    )}
                  </span>
                  {t(item.key)}
                  {item.fresh && <span className="sr-only">{t("justUnlocked")}</span>}
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

type ItemProps = { icon: LucideIcon; label: string; active: boolean; fresh?: boolean };

function ItemBody({ icon: Icon, label, active, fresh }: ItemProps) {
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
      {!active && fresh && (
        <span
          aria-hidden
          className="absolute inset-x-0.5 inset-y-1.5 rounded-xl border border-teal/50 bg-teal/10 shadow-[0_0_18px_-4px_var(--color-teal)]"
        />
      )}
      <span className="relative inline-block">
        <Icon aria-hidden className={cn("size-5", active ? "text-violet" : undefined)} />
        {fresh && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-teal shadow-[0_0_8px_var(--color-teal)] motion-safe:animate-pulse"
          />
        )}
      </span>
      <span className="relative max-w-full truncate text-[10px] leading-none font-medium tracking-tight">
        {label}
      </span>
    </>
  );
}

/** Dimmed, tappable to see what the section does and what unlocks it. */
function LockedBottomNavItem({ item }: { item: NavItemState }) {
  const t = useTranslations("nav");
  return (
    <LockedSectionPopover
      item={item}
      side="top"
      trigger={
        <button
          type="button"
          aria-label={t("lockedLabel", { section: t(item.key) })}
          data-tour={`nav-${item.key}`}
          className="relative flex min-w-11 flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl text-ink-muted/60 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <LockIcon aria-hidden className="size-5" />
          <span className="max-w-full truncate text-[10px] leading-none font-medium tracking-tight">
            {t(item.key)}
          </span>
        </button>
      }
    />
  );
}

const itemClass = (active: boolean) =>
  cn(
    "relative flex min-w-11 flex-1 flex-col items-center justify-center gap-1 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
    active ? "text-ink" : "text-ink-muted",
  );

function BottomNavLink({ href, tour, ...props }: ItemProps & { href: string; tour?: string }) {
  return (
    <Link
      href={href}
      data-tour={tour}
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
