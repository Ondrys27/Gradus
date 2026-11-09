import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/layout/logo";
import { APP_NAME } from "@/lib/constants";
import { localizedPath } from "@/lib/routes";
import type { BookingLocale } from "../booking/page-locale";
import { BookingLocaleSwitcher } from "./locale-switcher";

/**
 * The frame of every booking page (24.4): the Gradus mark top left linking
 * to the website and "Made with Gradus" at the bottom, both gone for a host
 * with the no-branding add-on; the language switch top right.
 */
export async function BookingFrame({
  locale,
  brandingHidden,
  children,
}: {
  locale: BookingLocale;
  brandingHidden: boolean;
  children: ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: "booking.frame" });
  const home = localizedPath("home", locale);
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pt-[calc(16px+env(safe-area-inset-top))] pb-[calc(16px+env(safe-area-inset-bottom))] md:px-8">
      <header className="flex items-center justify-between gap-3 py-2">
        {brandingHidden ? (
          <span />
        ) : (
          <Link
            href={home}
            className="flex min-h-11 items-center gap-3 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            data-testid="booking-brand"
          >
            <Logo className="size-8" />
            <span className="text-base font-bold tracking-tight text-ink">{APP_NAME}</span>
          </Link>
        )}
        <BookingLocaleSwitcher />
      </header>
      <main className="flex flex-1 flex-col py-6">{children}</main>
      {!brandingHidden && (
        <footer className="py-4 text-center text-xs text-ink-muted" data-testid="booking-made-with">
          <Link href={home} className="rounded outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50">
            {t("madeWith", { appName: APP_NAME })}
          </Link>
        </footer>
      )}
    </div>
  );
}
