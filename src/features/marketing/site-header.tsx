"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { MenuIcon, XIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Logo } from "@/components/layout/sidebar";
import { GuestLocaleSwitcher } from "@/features/auth/guest-locale-switcher";
import { APP_NAME } from "@/lib/constants";
import { homeAnchor, localizedPath, toSiteLocale } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { SignupCta } from "./signup-cta";

const linkClass =
  "flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50";

/** The website's own header: no sidebar, no Jarvis. */
export function SiteHeader({ signupEnabled }: { signupEnabled: boolean }) {
  const t = useTranslations("marketing.nav");
  const locale = toSiteLocale(useLocale());
  const [menuOpen, setMenuOpen] = useState(false);
  const home = localizedPath("home", locale);
  const links = [
    { href: homeAnchor(locale, "features"), label: t("features") },
    { href: localizedPath("pricing", locale), label: t("pricing") },
  ];

  return (
    <header className="sticky top-0 z-nav border-b border-line/60 bg-canvas/75 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 md:px-8">
        <Link
          href={home}
          aria-label={t("home", { appName: APP_NAME })}
          className="flex min-h-11 items-center gap-3 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Logo />
          <span className="text-lg font-bold tracking-tight text-ink">{APP_NAME}</span>
        </Link>

        <nav aria-label={t("label")} className="ml-4 hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={linkClass}>
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Suspense>
            <GuestLocaleSwitcher />
          </Suspense>
          <Link href={localizedPath("login", locale)} className={linkClass}>
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
          className="ml-auto grid size-11 cursor-pointer place-items-center rounded-xl text-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:hidden"
        >
          {menuOpen ? <XIcon aria-hidden className="size-6" /> : <MenuIcon aria-hidden className="size-6" />}
        </button>
      </div>

      <div
        id="site-menu"
        hidden={!menuOpen}
        className={cn("border-t border-line/60 px-4 pb-4 md:hidden")}
      >
        <nav aria-label={t("label")} className="flex flex-col py-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={linkClass}
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <Link href={localizedPath("login", locale)} className={linkClass}>
            {t("login")}
          </Link>
        </nav>
        <div className="flex flex-col gap-3">
          <SignupCta signupEnabled={signupEnabled} source="menu" className="w-full" />
          <Suspense>
            <GuestLocaleSwitcher className="self-start" />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
