"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { switchLocalePath, SITE_LOCALES } from "@/lib/routes";
import { cn } from "@/lib/utils";

/**
 * Language choice before sign-in: the same page at its address in the other
 * language. The address sets the language, which becomes the account's at
 * registration.
 */
export function GuestLocaleSwitcher({ className }: { className?: string }) {
  const t = useTranslations("topBar.account");
  const current = useLocale();
  const pathname = usePathname();
  const search = useSearchParams().toString();

  return (
    <div
      role="group"
      aria-label={t("language")}
      className={cn("flex gap-1 rounded-xl border border-line bg-surface/60 p-1", className)}
    >
      {SITE_LOCALES.map((code) => {
        const target = switchLocalePath(pathname, code) ?? pathname;
        return (
          <Link
            key={code}
            href={search ? `${target}?${search}` : target}
            aria-current={code === current ? "true" : undefined}
            hrefLang={code}
            className={cn(
              "flex min-h-11 items-center rounded-lg px-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 mouse:min-h-9",
              code === current ? "bg-violet/20 text-ink" : "text-ink-muted hover:text-ink",
            )}
          >
            {t(`languages.${code}`)}
          </Link>
        );
      })}
    </div>
  );
}
