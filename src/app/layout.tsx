import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import { getLocale, getMessages, getTimeZone, getTranslations } from "next-intl/server";
import { IntlProvider } from "@/components/intl-provider";
import { Background } from "@/components/layout/background";
import { Providers } from "@/components/providers";
import { APP_NAME } from "@/lib/constants";
import { DEFAULT_THEME, isThemeKey, THEME_COOKIE } from "@/lib/themes";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin", "latin-ext"] });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return {
    title: { default: APP_NAME, template: t("titleTemplate", { appName: APP_NAME }) },
    description: t("description", { appName: APP_NAME }),
  };
}

/**
 * `viewport-fit=cover` lets the page run under the notch and the home indicator,
 * which is what makes `env(safe-area-inset-*)` non-zero on iOS; every fixed bar
 * pads itself by those insets.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
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
    <html lang={locale} data-theme={theme} className={`dark ${inter.variable}`}>
      <body>
        <Background />
        <IntlProvider locale={locale} messages={messages} timeZone={timeZone}>
          <Providers>{children}</Providers>
        </IntlProvider>
      </body>
    </html>
  );
}
