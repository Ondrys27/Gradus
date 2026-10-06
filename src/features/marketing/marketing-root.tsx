import type { ReactNode } from "react";
import type { Metadata } from "next";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { IntlProvider } from "@/components/intl-provider";
import { RootDocument } from "@/components/root-document";
import { pickMessages } from "@/i18n/pick-messages";
import { APP_NAME } from "@/lib/constants";
import type { SiteLocale } from "@/lib/routes";
import { isPublicSignupEnabled } from "@/lib/signup";
import { DEFAULT_THEME } from "@/lib/themes";
import { MarketingProviders } from "./marketing-providers";
import { siteUrl } from "./seo";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

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
 * statically: no session, no cookies, the default theme.
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
      className="scroll-pt-24 scroll-smooth motion-reduce:scroll-auto"
    >
      {/* Without JavaScript, nothing may stay hidden waiting for its entrance. */}
      <noscript>
        <style>{"[data-reveal]{opacity:1!important;transform:none!important}"}</style>
      </noscript>
      <IntlProvider locale={locale} messages={messages} timeZone={SITE_TIME_ZONE}>
        <MarketingProviders>
          <div className="flex min-h-dvh flex-col">
            <SiteHeader signupEnabled={isPublicSignupEnabled()} />
            <main className="flex flex-1 flex-col">{children}</main>
            <SiteFooter />
          </div>
        </MarketingProviders>
      </IntlProvider>
    </RootDocument>
  );
}
