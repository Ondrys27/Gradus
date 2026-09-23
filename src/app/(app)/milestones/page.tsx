import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MilestonesView } from "@/features/milestones/milestones-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("milestones") };
}

export default function MilestonesPage() {
  return <MilestonesView />;
}
