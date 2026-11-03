import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PrivacyView } from "@/features/settings/privacy-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings.groups.privacy");
  return { title: t("title") };
}

export default function Page() {
  return <PrivacyView />;
}
