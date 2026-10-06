import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MilestoneDetail } from "@/features/milestones/milestone-detail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("milestones") };
}

export default async function MilestonePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MilestoneDetail id={id} />;
}
