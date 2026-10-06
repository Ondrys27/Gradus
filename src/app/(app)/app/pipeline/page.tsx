import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PipelineView } from "@/features/pipeline/pipeline-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("pipeline") };
}

export default function PipelinePage() {
  return <PipelineView />;
}
