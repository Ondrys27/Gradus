import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { APP_NAME } from "@/lib/constants";
import { LOCALIZED_PAGES, type SiteLocale } from "@/lib/routes";
import { contactEmail } from "./contact";
import { SupportForm } from "./support-form";

export async function supportMetadata(locale: SiteLocale): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "marketing.support" });
  return {
    title: t("title"),
    description: t("description", { appName: APP_NAME }),
    alternates: {
      canonical: LOCALIZED_PAGES.support[locale],
      languages: { cs: LOCALIZED_PAGES.support.cs, en: LOCALIZED_PAGES.support.en },
    },
  };
}

/**
 * /podpora (/en/support; 27.1): a form for anybody, signed in or not, that
 * files into the same bug reports as "Report a problem" in the app.
 */
export async function SupportPage({ locale }: { locale: SiteLocale }) {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "marketing.support" });
  const email = contactEmail();
  return (
    <article className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 py-16 md:py-24">
      <header className="flex flex-col gap-3">
        <h1 className="text-4xl font-bold tracking-tight text-balance text-ink md:text-5xl">
          {t("title")}
        </h1>
        <p className="text-ink-soft">{t("intro", { appName: APP_NAME })}</p>
        {email && (
          <p className="text-sm text-ink-muted">
            {t.rich("orEmail", {
              email,
              link: (chunks) => (
                <a href={`mailto:${email}`} className="font-medium text-violet underline-offset-4 hover:underline">
                  {chunks}
                </a>
              ),
            })}
          </p>
        )}
      </header>
      <SupportForm />
    </article>
  );
}
