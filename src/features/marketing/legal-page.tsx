import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { APP_NAME } from "@/lib/constants";
import type { SiteLocale } from "@/lib/routes";
import { pageMetadata } from "./seo";

export type LegalKind = "terms" | "privacy";

/** Section headings of each document; the texts come from the lawyer. */
const SECTIONS: Record<LegalKind, readonly string[]> = {
  terms: ["intro", "account", "trial", "pricing", "use", "liability", "termination", "final"],
  privacy: [
    "controller",
    "data",
    "purpose",
    "processors",
    "retention",
    "rights",
    "cookies",
    "contact",
  ],
};

export async function legalMetadata(locale: SiteLocale, kind: LegalKind): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "marketing.meta" });
  return pageMetadata({
    page: kind,
    locale,
    title: t(`${kind}Title`),
    description: t(`${kind}Description`, { appName: APP_NAME }),
  });
}

/** Terms and privacy until the lawyer's texts arrive: the headings and a clear notice. */
export async function LegalPage({ locale, kind }: { locale: SiteLocale; kind: LegalKind }) {
  setRequestLocale(locale);
  const [t, tMeta] = await Promise.all([
    getTranslations({ locale, namespace: "marketing.legal" }),
    getTranslations({ locale, namespace: "marketing.meta" }),
  ]);
  return (
    <article className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 py-16 md:py-24">
      <header className="flex flex-col gap-6">
        <h1 className="text-4xl font-bold tracking-tight text-balance text-ink md:text-5xl">
          {tMeta(`${kind}Title`)}
        </h1>
        <div role="note" className="rounded-card border border-gold/40 bg-gold/10 p-5">
          <p className="font-semibold text-gold">{t("soon")}</p>
          <p className="mt-1 text-ink-soft">{t("soonText")}</p>
        </div>
      </header>
      <ol className="flex flex-col gap-8">
        {SECTIONS[kind].map((section, index) => (
          <li key={section} className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold text-ink">
              {t("heading", { number: String(index + 1), title: t(`sections.${kind}.${section}`) })}
            </h2>
            <p className="text-ink-muted">{t("sectionSoon")}</p>
          </li>
        ))}
      </ol>
    </article>
  );
}
