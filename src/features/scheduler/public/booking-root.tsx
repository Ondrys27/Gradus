import type { ReactNode } from "react";
import { IntlProvider } from "@/components/intl-provider";
import { Providers } from "@/components/providers";
import { RootDocument } from "@/components/root-document";
import { pickMessages } from "@/i18n/pick-messages";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";
import { DEFAULT_THEME } from "@/lib/themes";
import type { BookingLocale } from "../booking/page-locale";

/** Texts the booking page's client side needs; nothing of the app. */
const CLIENT_MESSAGES = ["booking", "phone", "settings.region", "common", "errorPage"] as const;
const MESSAGES = { cs, en } as const;

/**
 * Root of the public booking pages (24.4): the language of the page (never
 * the app's cookie), the default theme, the bare canvas. No session is read
 * and nothing is stored but the guest's own choice of language and zone.
 */
export function BookingRoot({ locale, children }: { locale: BookingLocale; children: ReactNode }) {
  return (
    <RootDocument lang={locale} theme={DEFAULT_THEME} backdrop="plain">
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
