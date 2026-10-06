import type { ReactNode } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getLocale, getMessages, getTimeZone, getTranslations } from "next-intl/server";
import { IntlProvider } from "@/components/intl-provider";
import { Providers } from "@/components/providers";
import { RootDocument } from "@/components/root-document";
import { APP_NAME } from "@/lib/constants";
import { DEFAULT_THEME, isThemeKey, THEME_COOKIE } from "@/lib/themes";

/** Title template and description of the app and the sign-in pages. */
export async function appRootMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return {
    title: { default: APP_NAME, template: t("titleTemplate", { appName: APP_NAME }) },
    description: t("description", { appName: APP_NAME }),
  };
}

/**
 * Root of the app, the sign-in pages and the design system: rendered per
 * request, language from the address or the account, theme from the cookie.
 */
export async function AppRoot({ children }: { children: ReactNode }) {
  const [locale, messages, timeZone, cookieStore] = await Promise.all([
    getLocale(),
    getMessages(),
    getTimeZone(),
    cookies(),
  ]);
  // The theme shown last time; the app corrects it from user_settings once loaded.
  const storedTheme = cookieStore.get(THEME_COOKIE)?.value;
  const theme = isThemeKey(storedTheme) ? storedTheme : DEFAULT_THEME;

  return (
    <RootDocument lang={locale} theme={theme}>
      <IntlProvider locale={locale} messages={messages} timeZone={timeZone}>
        <Providers>{children}</Providers>
      </IntlProvider>
    </RootDocument>
  );
}
