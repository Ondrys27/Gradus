"use client";

import { useCallback, useEffect, type ReactElement } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Tooltip } from "@base-ui/react/tooltip";
import { LockIcon, PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useUpdateSettings, useUserSettings } from "@/features/account/queries";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { isActivePath } from "./nav-items";
import { useNavItems, type NavItemState } from "./use-nav";
import { LockedSectionPopover } from "./lock-hint";
import { BetaBadge } from "./beta-badge";
import { Logo } from "./logo";
import { isSidebarShortcut, isTypingTarget } from "./sidebar-shortcut";
import { useIsMac } from "@/lib/use-is-mac";
import { useIsWide, useReducedMotionSafe, WIDE_QUERY } from "@/lib/use-media-query";

/**
 * Icon rail from 768 px, hidden on phones. From 1024 px the full 240 px menu
 * with labels, which the user may collapse to the rail (the toggle at the
 * bottom or ⌘B / Ctrl+B); the choice is user_settings.sidebar_collapsed.
 * The width itself is --app-sidebar-width on the shell (globals.css).
 */
export function Sidebar() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const reduceMotion = useReducedMotionSafe();
  const { items } = useNavItems();
  const { collapsed, toggle } = useSidebarCollapse();
  // Labels are hidden on md anyway; a tooltip stands in for them only where
  // the user chose the rail. md keeps its native title as before.
  const wide = useIsWide();
  const tooltips = collapsed && wide;

  return (
    <aside className="fixed inset-y-0 left-0 z-nav hidden w-(--app-sidebar-width) flex-col overflow-hidden border-r border-line/70 bg-sidebar/85 pl-[env(safe-area-inset-left)] backdrop-blur-xl transition-[width] duration-200 ease-out motion-reduce:transition-none md:flex">
      <Link
        href="/app"
        className={cn(
          "flex h-18 shrink-0 items-center justify-center gap-3 px-5",
          !collapsed && "lg:justify-start",
        )}
      >
        <Logo />
        <span
          className={cn(
            "hidden text-lg font-bold tracking-tight text-ink",
            !collapsed && "lg:inline",
          )}
        >
          {APP_NAME}
        </span>
        <BetaBadge className={cn("hidden", !collapsed && "lg:inline-flex")} />
      </Link>

      <Tooltip.Provider delay={250}>
        <nav
          aria-label={t("label")}
          className="flex flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto px-3 py-2"
        >
          {items.map((item) => {
            if (item.locked) {
              return <LockedNavItem key={item.key} item={item} collapsed={collapsed} />;
            }
            const active = isActivePath(pathname, item.href);
            return (
              <NavTooltip key={item.key} label={t(item.key)} enabled={tooltips}>
                <Link
                  href={item.href}
                  data-tour={`nav-${item.key}`}
                  aria-current={active ? "page" : undefined}
                  aria-label={t(item.key)}
                  title={tooltips ? undefined : t(item.key)}
                  className={cn(
                    "group relative flex h-11 items-center justify-center gap-3 rounded-xl px-3 text-sm font-medium outline-none",
                    !collapsed && "lg:justify-start",
                    "focus-visible:ring-3 focus-visible:ring-ring/50",
                    active ? "text-ink" : "text-ink-soft hover:text-ink",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="sidebar-active"
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : { type: "spring", stiffness: 420, damping: 34 }
                      }
                      className="absolute inset-0 rounded-xl border border-violet/60 bg-violet/20 shadow-glow-strong"
                    />
                  )}
                  {!active && item.fresh && (
                    <span className="absolute inset-0 rounded-xl border border-teal/50 bg-teal/10 shadow-[0_0_18px_-4px_var(--color-teal)]" />
                  )}
                  {!active && (
                    <span className="absolute inset-0 rounded-xl bg-surface opacity-0 transition-opacity group-hover:opacity-100" />
                  )}
                  <span className="relative shrink-0">
                    <item.icon aria-hidden className={cn("size-5", active ? "text-violet" : undefined)} />
                    {item.fresh && <FreshDot />}
                  </span>
                  <span className={cn("relative hidden truncate", !collapsed && "lg:inline")}>
                    {t(item.key)}
                  </span>
                  {item.fresh && <span className="sr-only">{t("justUnlocked")}</span>}
                </Link>
              </NavTooltip>
            );
          })}
        </nav>

        <div className="hidden shrink-0 px-3 pt-2 pb-4 lg:block">
          <CollapseToggle collapsed={collapsed} onToggle={toggle} />
        </div>
      </Tooltip.Provider>
    </aside>
  );
}

/**
 * The saved choice and the ⌘B / Ctrl+B shortcut. Saved at once and shown
 * optimistically (useUpdateSettings rolls back if the save fails). The keys
 * work only where the toggle is, on wide screens.
 */
function useSidebarCollapse() {
  const collapsed = useUserSettings().sidebar_collapsed;
  const { mutate } = useUpdateSettings();
  const toggle = useCallback(() => mutate({ sidebar_collapsed: !collapsed }), [mutate, collapsed]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isSidebarShortcut(event) || isTypingTarget(event.target)) return;
      if (!window.matchMedia(WIDE_QUERY).matches) return;
      event.preventDefault();
      toggle();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  return { collapsed, toggle };
}

/** The name of a menu item beside its icon when only the icons show. */
function NavTooltip({
  label,
  enabled,
  children,
}: {
  label: string;
  enabled: boolean;
  children: ReactElement<Record<string, unknown>>;
}) {
  return (
    <Tooltip.Root disabled={!enabled}>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner side="right" sideOffset={10} className="z-popover">
          <Tooltip.Popup
            data-sidebar-tooltip=""
            className="rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-sm font-medium text-ink shadow-popover"
          >
            {label}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** At the bottom of the wide menu: collapse to icons or expand again. */
function CollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const t = useTranslations("nav.sidebar");
  const isMac = useIsMac();
  const label = collapsed ? t("expand") : t("collapse");
  const shortcut = isMac ? t("shortcutMac") : t("shortcut");
  const Icon = collapsed ? PanelLeftOpenIcon : PanelLeftCloseIcon;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <button
            type="button"
            onClick={onToggle}
            aria-label={label}
            aria-expanded={!collapsed}
            aria-keyshortcuts="Meta+B Control+B"
            className={cn(
              "group relative flex h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-sm font-medium text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50",
              collapsed ? "justify-center" : "justify-start",
            )}
          >
            <span className="absolute inset-0 rounded-xl bg-surface opacity-0 transition-opacity group-hover:opacity-100" />
            <Icon aria-hidden className="relative size-5 shrink-0" />
            {!collapsed && <span className="relative truncate">{label}</span>}
          </button>
        }
      />
      <Tooltip.Portal>
        <Tooltip.Positioner side="right" sideOffset={10} className="z-popover">
          <Tooltip.Popup className="flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-sm font-medium text-ink shadow-popover">
            {label}
            <kbd className="rounded-md border border-line px-1.5 font-sans text-xs text-ink-muted">
              {shortcut}
            </kbd>
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** Dimmed, not a link: a card explains what the section does and what unlocks it. */
function LockedNavItem({ item, collapsed }: { item: NavItemState; collapsed: boolean }) {
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
          className={cn(
            "group relative flex h-11 cursor-pointer items-center justify-center gap-3 rounded-xl px-3 text-sm font-medium text-ink-muted/60 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            !collapsed && "lg:justify-start",
          )}
        >
          <LockIcon aria-hidden className="relative size-5 shrink-0" />
          <span className={cn("relative hidden truncate", !collapsed && "lg:inline")}>
            {t(item.key)}
          </span>
        </button>
      }
    />
  );
}

/** A section just unlocked and not opened yet. */
function FreshDot() {
  const reduceMotion = useReducedMotionSafe();
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
