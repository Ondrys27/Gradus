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

/** The page's language; the guest's pick is the one thing (with the zone) the page remembers. */
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
    <div role="group" aria-label={t("language")} className="flex rounded-xl border border-line bg-surface p-1">
      {BOOKING_LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          lang={option}
          aria-pressed={option === locale}
          onClick={() => choose(option)}
          className={cn(
            "h-11 cursor-pointer rounded-lg px-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 mouse:h-8",
            option === locale ? "bg-violet text-white" : "text-ink-soft hover:text-ink",
          )}
        >
          {t(`languages.${option}`)}
        </button>
      ))}
    </div>
  );
}
