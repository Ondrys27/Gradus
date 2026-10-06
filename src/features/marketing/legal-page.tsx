import { getTranslations } from "next-intl/server";

/** Terms and privacy until the lawyer's texts arrive: the heading and a clear notice. */
export async function LegalPage({ title }: { title: string }) {
  const t = await getTranslations("marketing.legal");
  return (
    <article className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-16 md:py-24">
      <h1 className="text-4xl font-bold tracking-tight text-ink">{title}</h1>
      <div role="note" className="rounded-card border border-gold/40 bg-gold/10 p-5">
        <p className="font-semibold text-gold">{t("soon")}</p>
        <p className="mt-1 text-ink-soft">{t("soonText")}</p>
      </div>
    </article>
  );
}
