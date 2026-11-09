import type { ReactNode } from "react";
import { Bricolage_Grotesque } from "next/font/google";
import { IntlProvider } from "@/components/intl-provider";
import { Providers } from "@/components/providers";
import { RootDocument } from "@/components/root-document";
import { pickMessages } from "@/i18n/pick-messages";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";
import { DEFAULT_THEME } from "@/lib/themes";
import type { BookingLocale } from "../booking/page-locale";
import { BookingBackdrop } from "./backdrop";

/** Texts the booking page's client side needs; nothing of the app. */
const CLIENT_MESSAGES = ["booking", "phone", "settings.region", "common", "errorPage"] as const;
const MESSAGES = { cs, en } as const;

/*
 * The booking page belongs to the public website, so its headlines wear the
 * website's face (Bricolage Grotesque, see marketing-root); body text stays
 * in Inter like everywhere else.
 */
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin", "latin-ext"],
  axes: ["opsz"],
  display: "swap",
});

/**
 * Root of the public booking pages (24.4): the language of the page (never
 * the app's cookie), the default theme and the page's own moving backdrop
 * (24.5). No session is read and nothing is stored but the guest's own
 * choice of language and zone.
 */
export function BookingRoot({ locale, children }: { locale: BookingLocale; children: ReactNode }) {
  return (
    <RootDocument lang={locale} theme={DEFAULT_THEME} backdrop="plain" className={bricolage.variable}>
      <BookingBackdrop />
      <IntlProvider
        locale={locale}
        messages={pickMessages(MESSAGES[locale], CLIENT_MESSAGES)}
        timeZone="UTC"
      >
        <Providers>{children}</Providers>
      </IntlProvider>
    </RootDocument>
  );
}
