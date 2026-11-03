import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AppearanceView } from "@/features/settings/appearance-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings.groups.appearance");
  return { title: t("title") };
}

export default function Page() {
  return <AppearanceView />;
}
