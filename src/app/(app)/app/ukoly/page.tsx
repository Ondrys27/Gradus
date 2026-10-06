import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WorkerTasksView } from "@/features/workers/worker-env/worker-tasks-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("myTasks") };
}

export default function MyTasksPage() {
  return <WorkerTasksView />;
}
