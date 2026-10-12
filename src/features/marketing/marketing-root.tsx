import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Bricolage_Grotesque, Caveat } from "next/font/google";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { IntlProvider } from "@/components/intl-provider";
import { RootDocument } from "@/components/root-document";
import { pickMessages } from "@/i18n/pick-messages";
import { APP_NAME } from "@/lib/constants";
import type { SiteLocale } from "@/lib/routes";
import { isPublicSignupEnabled } from "@/lib/signup";
import { DEFAULT_THEME } from "@/lib/themes";
import { cn } from "@/lib/utils";
import { MarketingProviders } from "./marketing-providers";
import { siteUrl } from "./seo";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

/*
 * The website's own faces, downloaded at build time and served from our
 * domain (next/font). Bricolage Grotesque carries the headlines: a grotesk
 * with some character, tight at display sizes thanks to its optical size
 * axis, and with Czech diacritics. Caveat is the handwriting of the notes
 * drawn onto the screenshots. Body text stays in Inter, like the app.
 */
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin", "latin-ext"],
  axes: ["opsz"],
  display: "swap",
});
const caveat = Caveat({
  variable: "--font-caveat",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

/**
 * The website shows no dates or times; a fixed zone only keeps the server and
 * the browser rendering the same markup (a visitor has no settings yet).
 */
const SITE_TIME_ZONE = "Europe/Prague";

/** Texts the website's client components need; the app's texts stay on the server. */
const CLIENT_MESSAGES = ["marketing", "plans", "topBar.account"] as const;

export async function marketingRootMetadata(locale: SiteLocale): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: APP_NAME, template: t("titleTemplate", { appName: APP_NAME }) },
    description: t("description", { appName: APP_NAME }),
    applicationName: APP_NAME,
  };
}

/**
 * Root of the public website in one language. The language comes from the
 * address via `setRequestLocale`, so every page under it can be generated
 * statically: no session, no cookies, the default theme. The backdrop is the
 * bare canvas: the website has one light, in the hero, and nothing else.
 */
export async function MarketingRoot({
  locale,
  children,
}: {
  locale: SiteLocale;
  children: ReactNode;
}) {
  setRequestLocale(locale);
  const messages = pickMessages(await getMessages(), CLIENT_MESSAGES);

  return (
    <RootDocument
      lang={locale}
      theme={DEFAULT_THEME}
      backdrop="plain"
      className={cn(
        "scroll-pt-24 scroll-smooth motion-reduce:scroll-auto",
        bricolage.variable,
        caveat.variable,
      )}
    >
      <IntlProvider locale={locale} messages={messages} timeZone={SITE_TIME_ZONE}>
        <MarketingProviders>
          <div className="flex min-h-dvh flex-col">
            <SiteHeader signupEnabled={isPublicSignupEnabled()} />
            {/* Screenshots run past the grid on purpose; the page itself never scrolls sideways. */}
            <main className="flex flex-1 flex-col overflow-x-clip">{children}</main>
            <SiteFooter />
          </div>
        </MarketingProviders>
      </IntlProvider>
    </RootDocument>
  );
}
