"use client";

import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/ui/page-header";
import { Stagger, StaggerItem } from "@/components/ui/stagger";
import { useSession } from "@/features/account/queries";
import { WorkerTaskList } from "../worker-task-list";

/** Tasks from the owner; the worker ticks them off. */
export function WorkerTasksView() {
  const t = useTranslations("workers.myTasks");
  const { worker } = useSession();
  if (!worker) return null;

  return (
    <Stagger className="flex flex-col gap-8">
      <StaggerItem>
        <PageHeader title={t("title")} description={t("description")} />
      </StaggerItem>
      <StaggerItem>
        <WorkerTaskList workerId={worker.id} mode="worker" />
      </StaggerItem>
    </Stagger>
  );
}
