import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WorkerDetail } from "@/features/workers/worker-detail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("workers") };
}

export default async function WorkerPage({ params }: { params: Promise<{ workerId: string }> }) {
  const { workerId } = await params;
  return <WorkerDetail workerId={workerId} />;
}
