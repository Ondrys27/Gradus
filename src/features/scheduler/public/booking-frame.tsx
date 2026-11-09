import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/layout/logo";
import { APP_NAME } from "@/lib/constants";
import { localizedPath } from "@/lib/routes";
import type { BookingLocale } from "../booking/page-locale";
import { BookingLocaleSwitcher } from "./locale-switcher";

/**
 * The frame of every booking page (24.4, drawn in 24.5): the Gradus lockup
 * top left linking to the website and a colophon "Made with Gradus" under a
 * hairline at the bottom; the language switch top right. A host with the
 * no-branding add-on gets their own name in the lockup's place and no
 * colophon, so the page keeps its shape either way.
 */
export async function BookingFrame({
  locale,
  brandingHidden,
  ownBrand,
  children,
}: {
  locale: BookingLocale;
  brandingHidden: boolean;
  /** What stands top left instead of the Gradus lockup when branding is hidden. */
  ownBrand?: string | null;
  children: ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: "booking.frame" });
  const home = localizedPath("home", locale);
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 pt-[calc(12px+env(safe-area-inset-top))] pb-[calc(12px+env(safe-area-inset-bottom))] md:px-10">
      <header className="flex min-h-14 items-center justify-between gap-4">
        {brandingHidden ? (
          <span className="truncate font-display text-base font-semibold tracking-tight text-ink-soft">
            {ownBrand}
          </span>
        ) : (
          <Link
            href={home}
            className="group flex min-h-11 items-center gap-2.5 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            data-testid="booking-brand"
          >
            <Logo className="size-7 rounded-lg text-sm shadow-none" />
            <span className="font-display text-lg font-bold tracking-tight text-ink">{APP_NAME}</span>
          </Link>
        )}
        <BookingLocaleSwitcher />
      </header>
      <main className="flex flex-1 flex-col py-8 md:py-10">{children}</main>
      {!brandingHidden && (
        <footer className="flex items-center gap-4 pt-2 pb-2 text-xs text-ink-muted" data-testid="booking-made-with">
          <span aria-hidden className="h-px flex-1 bg-line/70" />
          <Link
            href={home}
            className="flex min-h-11 items-center gap-2 rounded-lg px-1 outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Logo className="size-4 rounded-[5px] text-[9px] shadow-none" />
            {t("madeWith", { appName: APP_NAME })}
          </Link>
          <span aria-hidden className="h-px flex-1 bg-line/70" />
        </footer>
      )}
    </div>
  );
}
