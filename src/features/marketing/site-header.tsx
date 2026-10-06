"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "framer-motion";
import { MenuIcon, XIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Logo } from "@/components/layout/logo";
import { GuestLocaleSwitcher } from "@/features/auth/guest-locale-switcher";
import { APP_NAME } from "@/lib/constants";
import { homeAnchor, localizedPath, toSiteLocale } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { SignupCta } from "./signup-cta";

/** From this scroll offset (px) the header is compact and glassy. */
const COMPACT_AFTER_PX = 16;

const linkClass =
  "flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-ink-soft outline-none transition-colors hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * The website's header: logo, the three anchors in the middle, language,
 * sign-in and the main button on the right. Fixed, so the page never jumps
 * when it gets compact and glassy on scroll; a spacer of its full height
 * keeps the content below it. Phones get a full-screen menu.
 */
export function SiteHeader({ signupEnabled }: { signupEnabled: boolean }) {
  const t = useTranslations("marketing.nav");
  const locale = toSiteLocale(useLocale());
  const [menuOpen, setMenuOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, "change", (y) => setCompact(y > COMPACT_AFTER_PX));

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setMenuOpen(false);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", close);
    };
  }, [menuOpen]);

  const links = [
    { href: homeAnchor(locale, "features"), label: t("features") },
    { href: homeAnchor(locale, "howItWorks"), label: t("howItWorks") },
    { href: homeAnchor(locale, "pricing"), label: t("pricing") },
  ];
  const login = localizedPath("login", locale);
  const glassy = compact || menuOpen;

  return (
    <>
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-nav pt-[env(safe-area-inset-top)] transition-[background-color,border-color,backdrop-filter] duration-300",
          glassy
            ? "border-b border-line/60 bg-canvas/70 backdrop-blur-xl backdrop-saturate-150"
            : "border-b border-transparent",
        )}
      >
        <div
          className={cn(
            "mx-auto flex max-w-6xl items-center gap-4 px-4 transition-[height] duration-300 md:px-8 lg:grid lg:grid-cols-[1fr_auto_1fr]",
            compact ? "h-16" : "h-16 md:h-20",
          )}
        >
          <Link
            href={localizedPath("home", locale)}
            aria-label={t("home", { appName: APP_NAME })}
            className="flex min-h-11 items-center gap-3 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Logo />
            <span className="text-lg font-bold tracking-tight text-ink">{APP_NAME}</span>
          </Link>

          <nav aria-label={t("label")} className="hidden justify-center lg:flex">
            <ul className="flex items-center gap-1">
              {links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={linkClass}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="ml-auto hidden items-center justify-end gap-2 lg:flex">
            <Suspense>
              <GuestLocaleSwitcher short />
            </Suspense>
            <Link href={login} className={linkClass}>
              {t("login")}
            </Link>
            <SignupCta signupEnabled={signupEnabled} source="header" />
          </div>

          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="site-menu"
            aria-label={menuOpen ? t("closeMenu") : t("menu")}
            onClick={() => setMenuOpen((open) => !open)}
            className="ml-auto grid size-11 cursor-pointer place-items-center rounded-xl text-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/50 lg:hidden"
          >
            {menuOpen ? (
              <XIcon aria-hidden className="size-6" />
            ) : (
              <MenuIcon aria-hidden className="size-6" />
            )}
          </button>
        </div>

        <AnimatePresence>
          {menuOpen && (
            <motion.div
              id="site-menu"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="flex h-[calc(100dvh-4rem-env(safe-area-inset-top))] flex-col gap-8 overflow-y-auto px-4 pt-6 pb-[calc(24px+env(safe-area-inset-bottom))] lg:hidden"
            >
              <nav aria-label={t("label")}>
                <ul className="flex flex-col">
                  {links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        onClick={() => setMenuOpen(false)}
                        className="flex min-h-14 items-center border-b border-line/60 text-2xl font-semibold text-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                  <li>
                    <Link
                      href={login}
                      className="flex min-h-14 items-center border-b border-line/60 text-2xl font-semibold text-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {t("login")}
                    </Link>
                  </li>
                </ul>
              </nav>
              <div className="mt-auto flex flex-col gap-4">
                <SignupCta
                  signupEnabled={signupEnabled}
                  source="menu"
                  long
                  size="lg"
                  className="w-full"
                />
                <Suspense>
                  <GuestLocaleSwitcher short className="self-center" />
                </Suspense>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>
      {/* Keeps the page below the fixed header. */}
      <div
        aria-hidden
        className="h-[calc(4rem+env(safe-area-inset-top))] shrink-0 md:h-[calc(5rem+env(safe-area-inset-top))]"
      />
    </>
  );
}
