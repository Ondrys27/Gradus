"use client";

import { useState } from "react";
import Link from "next/link";
import { GiftIcon, UserPlusIcon, UsersRoundIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Stagger, StaggerItem } from "@/components/ui/stagger";
import { MarkSeenOnVisit } from "@/features/game/mark-seen-on-visit";
import { todayIsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { monthStartOf } from "./logic";
import { useWorkerMonthStats, useWorkerProfiles, useWorkers } from "./queries";
import { WorkerCard } from "./worker-card";
import { WorkerFormDialog } from "./worker-form-dialog";

/** The owner's team as cards, with adding a worker and the reward system up top. */
export function WorkersView() {
  const t = useTranslations("workers");
  const tSections = useTranslations("sections.workers");
  const tNav = useTranslations("nav");
  const settings = useFormatSettings();
  const workers = useWorkers();
  const stats = useWorkerMonthStats(monthStartOf(todayIsoDate(settings)));
  const accountIds = (workers.data ?? []).flatMap((worker) =>
    worker.user_id ? [worker.user_id] : [],
  );
  const profiles = useWorkerProfiles(accountIds);
  const [adding, setAdding] = useState(false);

  return (
    <Stagger className="flex flex-col gap-8">
      <MarkSeenOnVisit section="workers" />
      <StaggerItem>
        <PageHeader
          title={tNav("workers")}
          description={tSections("description")}
          actions={
            <>
              <Link href="/workers/rewards" className={buttonVariants({ variant: "outline" })}>
                <GiftIcon aria-hidden data-icon="inline-start" />
                {t("rewardSystem")}
              </Link>
              <Button onClick={() => setAdding(true)}>
                <UserPlusIcon aria-hidden data-icon="inline-start" />
                {t("add")}
              </Button>
            </>
          }
        />
      </StaggerItem>

      <StaggerItem>
        {workers.isError ? (
          <FormAlert>{t("loadFailed")}</FormAlert>
        ) : !workers.data ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden>
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-52 w-full rounded-card" />
            ))}
          </div>
        ) : workers.data.length === 0 ? (
          <EmptyState
            icon={<UsersRoundIcon />}
            title={tSections("emptyTitle")}
            description={tSections("emptyDescription")}
            action={
              <Button onClick={() => setAdding(true)}>
                <UserPlusIcon aria-hidden data-icon="inline-start" />
                {t("add")}
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {stats.isError && <FormAlert>{t("statsFailed")}</FormAlert>}
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {workers.data.map((worker) => (
                <li key={worker.id}>
                  <WorkerCard
                    worker={worker}
                    profile={worker.user_id ? profiles.data?.get(worker.user_id) : undefined}
                    stats={
                      stats.data
                        ? (stats.data.get(worker.id) ?? {
                            workSeconds: 0,
                            earned: 0,
                            pendingAmount: 0,
                            pendingCount: 0,
                            tasksTotal: 0,
                            tasksDone: 0,
                          })
                        : undefined
                    }
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </StaggerItem>

      <WorkerFormDialog open={adding} onOpenChange={setAdding} worker={null} />
    </Stagger>
  );
}
