import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { getLocale, getMessages, getTimeZone, getTranslations } from "next-intl/server";
import { IntlProvider } from "@/components/intl-provider";
import { Background } from "@/components/layout/background";
import { Providers } from "@/components/providers";
import { APP_NAME } from "@/lib/constants";
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
  const [locale, messages, timeZone] = await Promise.all([
    getLocale(),
    getMessages(),
    getTimeZone(),
  ]);

  return (
    <html lang={locale} className={`dark ${inter.variable}`}>
      <body>
        <Background />
        <IntlProvider locale={locale} messages={messages} timeZone={timeZone}>
          <Providers>{children}</Providers>
        </IntlProvider>
      </body>
    </html>
  );
}
