import { Suspense } from "react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Logo } from "@/components/layout/logo";
import { GuestLocaleSwitcher } from "@/features/auth/guest-locale-switcher";
import { APP_NAME } from "@/lib/constants";
import { homeAnchor, localizedPath, toSiteLocale } from "@/lib/routes";
import { contactEmail } from "./contact";

const linkClass =
  "flex min-h-11 items-center text-sm text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 mouse:min-h-8";

export async function SiteFooter() {
  const [t, tNav, rawLocale] = await Promise.all([
    getTranslations("marketing.footer"),
    getTranslations("marketing.nav"),
    getLocale(),
  ]);
  const locale = toSiteLocale(rawLocale);
  const email = contactEmail();
  const links = [
    { href: homeAnchor(locale, "features"), label: tNav("features") },
    { href: localizedPath("pricing", locale), label: tNav("pricing") },
    { href: localizedPath("login", locale), label: tNav("login") },
    { href: localizedPath("terms", locale), label: t("terms") },
    { href: localizedPath("privacy", locale), label: t("privacy") },
  ];

  return (
    <footer
      aria-label={t("label")}
      className="border-t border-line/60 pb-[calc(24px+env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 pt-12 md:flex-row md:items-start md:justify-between md:px-8">
        <div className="flex flex-col gap-3">
          <Link
            href={localizedPath("home", locale)}
            className="flex min-h-11 items-center gap-3 self-start rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Logo />
            <span className="text-lg font-bold tracking-tight text-ink">{APP_NAME}</span>
          </Link>
          <p className="max-w-xs text-sm text-ink-muted">{t("tagline", { appName: APP_NAME })}</p>
        </div>
        <nav
          aria-label={t("navLabel")}
          className="grid grid-cols-2 gap-x-8 sm:flex sm:flex-wrap sm:gap-x-6"
        >
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={linkClass}>
              {link.label}
            </Link>
          ))}
          {email && (
            <a href={`mailto:${email}`} className={linkClass}>
              {t("contact")}
            </a>
          )}
        </nav>
        <Suspense>
          <GuestLocaleSwitcher short className="self-start" />
        </Suspense>
      </div>
      <p className="mx-auto mt-8 max-w-6xl px-4 text-sm text-ink-muted md:px-8">
        {t("copyright", { year: String(new Date().getFullYear()), appName: APP_NAME })}
      </p>
    </footer>
  );
}
