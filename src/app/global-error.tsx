"use client";

import { useEffect, useState } from "react";
import { IntlProvider } from "@/components/intl-provider";
import { RootDocument } from "@/components/root-document";
import { ADMIN_PATH } from "@/features/admin/access";
import { ErrorScreen, type ErrorHome } from "@/features/errors/error-screen";
import { LOCALE_COOKIE } from "@/i18n/locale-cookie";
import { APP_HOME_PATH, DEFAULT_SITE_LOCALE, localizedPath, type SiteLocale } from "@/lib/routes";
import { DEFAULT_THEME } from "@/lib/themes";

type Messages = Record<string, unknown>;

/** The page's language: /en in the address, else the remembered one, else Czech. */
function localeOfPage(): SiteLocale {
  const path = window.location.pathname;
  if (path === "/en" || path.startsWith("/en/")) return "en";
  const stored = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${LOCALE_COOKIE}=`))
    ?.slice(LOCALE_COOKIE.length + 1);
  return stored === "en" || stored === "cs" ? stored : DEFAULT_SITE_LOCALE;
}

function homeOfPage(locale: SiteLocale): { home: ErrorHome; href: string } {
  const path = window.location.pathname;
  if (path === ADMIN_PATH || path.startsWith(`${ADMIN_PATH}/`))
    return { home: "admin", href: ADMIN_PATH };
  if (path === APP_HOME_PATH || path.startsWith(`${APP_HOME_PATH}/`)) {
    return { home: "app", href: APP_HOME_PATH };
  }
  return { home: "site", href: localizedPath("home", locale) };
}

/**
 * The last resort: a root layout itself failed, so nothing of the site is
 * there, not even its texts. The error page's texts are fetched on demand
 * (only this namespace is kept), so they never weigh on a normal page load.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [page, setPage] = useState<{
    locale: SiteLocale;
    messages: Messages;
    home: ErrorHome;
    href: string;
  } | null>(null);

  useEffect(() => {
    const locale = localeOfPage();
    const load = locale === "en" ? import("@/locales/en.json") : import("@/locales/cs.json");
    load
      .then((module) => {
        setPage({
          locale,
          messages: { errorPage: module.default.errorPage },
          ...homeOfPage(locale),
        });
      })
      .catch(() => undefined);
  }, []);

  return (
    <RootDocument lang={page?.locale ?? DEFAULT_SITE_LOCALE} theme={DEFAULT_THEME} backdrop="plain">
      {page && (
        <IntlProvider locale={page.locale} messages={page.messages} timeZone="Europe/Prague">
          <main className="flex min-h-dvh items-center justify-center px-4">
            <ErrorScreen
              error={error}
              // The root layout failed: only a fresh load can bring it back.
              onRetry={() => window.location.reload()}
              home={page.home}
              homeHref={page.href}
            />
          </main>
        </IntlProvider>
      )}
    </RootDocument>
  );
}
