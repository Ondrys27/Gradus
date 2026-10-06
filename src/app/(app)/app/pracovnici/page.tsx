import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WorkersView } from "@/features/workers/workers-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("workers") };
}

export default function WorkersPage() {
  return <WorkersView />;
}
