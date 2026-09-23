"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { writeLocaleCookie } from "@/i18n/locale-cookie";
import { locales, type Locale } from "@/i18n/locales";
import { cn } from "@/lib/utils";

/** Language choice before sign-in. It becomes the account's language at registration. */
export function GuestLocaleSwitcher() {
  const t = useTranslations("topBar.account");
  const current = useLocale();
  const router = useRouter();
  const [, startTransition] = useTransition();

  return (
    <div
      role="group"
      aria-label={t("language")}
      className="flex gap-1 rounded-xl border border-line bg-surface/60 p-1"
    >
      {locales.map((code) => (
        <button
          key={code}
          type="button"
          aria-pressed={code === current}
          onClick={() => {
            writeLocaleCookie(code as Locale);
            startTransition(() => router.refresh());
          }}
          className={cn(
            "min-h-11 cursor-pointer rounded-lg px-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 mouse:min-h-9",
            code === current ? "bg-violet/20 text-ink" : "text-ink-muted hover:text-ink",
          )}
        >
          {t(`languages.${code}`)}
        </button>
      ))}
    </div>
  );
}
