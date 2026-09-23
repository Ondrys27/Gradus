"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import { motion, useReducedMotion } from "framer-motion";
import { EllipsisIcon, XIcon, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { bottomNavKeys, isActivePath, navItems } from "./nav-items";

const primaryItems = navItems.filter((item) => bottomNavKeys.includes(item.key));
const moreItems = navItems.filter((item) => !bottomNavKeys.includes(item.key));

/**
 * Floating glass bar for phones. It stops short of the right edge:
 * the bottom-right corner belongs to Jarvis.
 */
export function BottomNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = moreItems.some((item) => isActivePath(pathname, item.href));

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

      <Dialog.Root open={moreOpen} onOpenChange={setMoreOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-canvas/70 backdrop-blur-sm transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 md:hidden" />
          <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border-t border-line-strong bg-surface px-4 pt-3 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-popover outline-none transition-transform duration-250 ease-out data-ending-style:translate-y-full data-starting-style:translate-y-full md:hidden">
            <div aria-hidden className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line-strong" />
            <div className="mb-3 flex items-center justify-between">
              <Dialog.Title className="micro-label">{t("more")}</Dialog.Title>
              <Dialog.Close
                aria-label={t("close")}
                className="-mr-2 grid size-11 place-items-center rounded-full text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <XIcon aria-hidden className="size-5" />
              </Dialog.Close>
            </div>
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
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
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
