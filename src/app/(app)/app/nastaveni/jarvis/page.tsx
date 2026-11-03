import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { JarvisView } from "@/features/settings/jarvis-settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings.groups.jarvis");
  return { title: t("title") };
}

export default function Page() {
  return <JarvisView />;
}
