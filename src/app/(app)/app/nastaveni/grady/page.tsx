import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { GradyView } from "@/features/settings/grady-settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings.groups.grady");
  return { title: t("title") };
}

export default function Page() {
  return <GradyView />;
}
