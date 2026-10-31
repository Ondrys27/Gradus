import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TasksView } from "@/features/crm-tasks/tasks-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("tasks") };
}

export default function TasksPage() {
  return <TasksView />;
}
