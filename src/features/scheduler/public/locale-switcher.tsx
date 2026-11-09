"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  BOOKING_LOCALE_COOKIE,
  BOOKING_LOCALES,
  bookingCookie,
  type BookingLocale,
} from "../booking/page-locale";

/**
 * The page's language as two quiet words; the chosen one stands in ink with a
 * short underline. The guest's pick is the one thing (with the zone) the page
 * remembers.
 */
export function BookingLocaleSwitcher() {
  const t = useTranslations("booking.frame");
  const locale = useLocale();
  const router = useRouter();

  function choose(next: BookingLocale) {
    if (next === locale) return;
    document.cookie = bookingCookie(BOOKING_LOCALE_COOKIE, next);
    router.refresh();
  }

  return (
    <div role="group" aria-label={t("language")} className="flex items-center gap-1">
      {BOOKING_LOCALES.map((option, index) => (
        <span key={option} className="flex items-center gap-1">
          {index > 0 && <span aria-hidden className="text-ink-muted/60">·</span>}
          <button
            type="button"
            lang={option}
            aria-pressed={option === locale}
            onClick={() => choose(option)}
            className={cn(
              "relative min-h-11 cursor-pointer rounded-lg px-2 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 mouse:min-h-8",
              option === locale
                ? "text-ink after:absolute after:inset-x-2 after:bottom-2 after:h-px after:bg-teal mouse:after:bottom-1"
                : "text-ink-muted hover:text-ink-soft",
            )}
          >
            {t(`languages.${option}`)}
          </button>
        </span>
      ))}
    </div>
  );
}
