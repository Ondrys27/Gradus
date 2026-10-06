import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LegalPage } from "@/features/marketing/legal-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing.meta");
  return { title: t("termsTitle") };
}

export default async function Page() {
  const t = await getTranslations("marketing.meta");
  return <LegalPage title={t("termsTitle")} />;
}
