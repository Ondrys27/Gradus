import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WorkView } from "@/features/settings/work-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings.groups.work");
  return { title: t("title") };
}

export default function Page() {
  return <WorkView />;
}
