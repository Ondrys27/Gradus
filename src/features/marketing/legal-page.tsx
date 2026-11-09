import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLegalComplete, legalOperator } from "@/config/legal";
import { APP_NAME } from "@/lib/constants";
import type { SiteLocale } from "@/lib/routes";
import { pageMetadata } from "./seo";

export type LegalKind = "terms" | "privacy";

/**
 * Each section of a document with its paragraph keys under
 * `marketing.legal.bodies.<kind>.<section>`: the beta's texts with what paid
 * plans need (seller, price and payment through Stripe, automatic renewal,
 * cancelling, a consumer's withdrawal, complaints, Stripe as a processor).
 * A lawyer reviews them before launch.
 */
export const LEGAL_SECTIONS: Record<LegalKind, Record<string, readonly string[]>> = {
  terms: {
    intro: ["p1", "p2"],
    seller: ["p1", "p2"],
    account: ["p1", "p2"],
    trial: ["p1", "p2"],
    beta: ["p1", "p2"],
    prices: ["p1", "p2", "p3", "p4"],
    renewal: ["p1", "p2", "p3"],
    cancellation: ["p1", "p2", "p3"],
    withdrawal: ["p1", "p2", "p3"],
    complaints: ["p1", "p2"],
    warranty: ["p1", "p2"],
    data: ["p1", "p2", "p3"],
    feedback: ["p1", "p2"],
    use: ["p1", "p2"],
    liability: ["p1", "p2"],
    termination: ["p1", "p2"],
    changes: ["p1"],
    law: ["p1", "p2"],
    contact: ["p1"],
  },
  privacy: {
    controller: ["p1", "p2"],
    data: ["p1", "p2", "p3", "p4", "p5", "p6"],
    purpose: ["p1", "p2", "p3", "p4"],
    usage: ["p1", "p2", "p3"],
    ai: ["p1", "p2", "p3"],
    processors: ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"],
    retention: ["p1", "p2", "p3", "p4"],
    rights: ["p1", "p2", "p3"],
    cookies: ["p1", "p2"],
    contact: ["p1"],
  },
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

/**
 * Terms and privacy, with a visible note that a lawyer reviews them before
 * launch. The operator comes from the configuration (config/legal.ts);
 * whatever is missing shows as [DOPLNIT], and in production it can not be
 * shown at all: generating the page fails, so the production build fails.
 */
export async function LegalPage({ locale, kind }: { locale: SiteLocale; kind: LegalKind }) {
  setRequestLocale(locale);
  const [t, tMeta] = await Promise.all([
    getTranslations({ locale, namespace: "marketing.legal" }),
    getTranslations({ locale, namespace: "marketing.meta" }),
  ]);
  const operator = legalOperator();
  assertLegalComplete(operator);
  const missing = t("missing");
  const values = {
    appName: APP_NAME,
    name: operator.name ?? missing,
    companyId: operator.companyId ?? missing,
    address: operator.address ?? missing,
    email: operator.email ?? missing,
    backupDays: operator.backupDays ?? missing,
  };
  // Keys come from LEGAL_SECTIONS; a test checks each one exists in both languages.
  const text = t as unknown as (key: string, values?: Record<string, string>) => string;
  return (
    <article className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 py-16 md:py-24">
      <header className="flex flex-col gap-6">
        <h1 className="text-4xl font-bold tracking-tight text-balance text-ink md:text-5xl">
          {tMeta(`${kind}Title`)}
        </h1>
        <div role="note" className="rounded-card border border-gold/40 bg-gold/10 p-5">
          <p className="font-semibold text-gold">{t("betaNotice")}</p>
          <p className="mt-1 text-ink-soft">{t("betaNoticeText", { appName: APP_NAME })}</p>
        </div>
      </header>
      <ol className="flex flex-col gap-8">
        {Object.entries(LEGAL_SECTIONS[kind]).map(([section, paragraphs], index) => (
          <li key={section} id={section} className="flex scroll-mt-24 flex-col gap-2">
            <h2 className="text-xl font-semibold text-ink">
              {t("heading", {
                number: String(index + 1),
                title: text(`sections.${kind}.${section}`),
              })}
            </h2>
            {paragraphs.map((key) => (
              <p key={key} className="text-ink-soft">
                {text(`bodies.${kind}.${section}.${key}`, values)}
              </p>
            ))}
          </li>
        ))}
      </ol>
    </article>
  );
}
