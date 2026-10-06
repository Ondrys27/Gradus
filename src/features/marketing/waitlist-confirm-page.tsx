import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { SiteLocale } from "@/lib/routes";
import { WaitlistConfirm } from "./waitlist-confirm";

export async function waitlistConfirmMetadata(locale: SiteLocale): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "marketing.meta" });
  return { title: t("waitlistTitle"), robots: { index: false } };
}

/** The link from the waitlist e-mail lands here with its token. */
export async function WaitlistConfirmPage({
  locale,
  searchParams,
}: {
  locale: SiteLocale;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  setRequestLocale(locale);
  const { token } = await searchParams;
  return (
    <section className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-16">
      <WaitlistConfirm token={typeof token === "string" ? token.slice(0, 128) : ""} />
    </section>
  );
}
