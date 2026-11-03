"use client";

import Link from "next/link";
import { GiftIcon, CoinsIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { todayIsoDate } from "@/lib/format";
import { COMPANY_PATH } from "@/lib/routes";
import { useFormatSettings } from "@/lib/use-format-settings";
import { monthStartOf } from "../logic";
import { useWorkerMonthStats, useWorkerProfiles, useWorkers } from "../queries";
import { WorkerCard } from "../worker-card";

const EMPTY_MONTH = {
  workSeconds: 0,
  earned: 0,
  pendingAmount: 0,
  pendingCount: 0,
  tasksTotal: 0,
  tasksDone: 0,
};

/**
 * Rewards and payouts of everyone at a glance: this month's time, earnings and
 * what waits for approval, with the reward system one click away. Payouts and
 * time of one worker are on their page.
 */
export function CompanyRewards() {
  const t = useTranslations("workers");
  const tc = useTranslations("workers.company.rewards");
  const settings = useFormatSettings();
  const workers = useWorkers();
  const stats = useWorkerMonthStats(monthStartOf(todayIsoDate(settings)));
  const accountIds = (workers.data ?? []).flatMap((worker) =>
    worker.user_id ? [worker.user_id] : [],
  );
  const profiles = useWorkerProfiles(accountIds);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm text-ink-soft">{tc("description")}</p>
        <Link
          href={`${COMPANY_PATH}/odmeny`}
          className={buttonVariants({ variant: "outline", className: "self-start sm:self-auto" })}
        >
          <GiftIcon aria-hidden data-icon="inline-start" />
          {tc("system")}
        </Link>
      </div>
      {workers.isError ? (
        <FormAlert>{t("loadFailed")}</FormAlert>
      ) : !workers.data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-52 w-full rounded-card" />
          ))}
        </div>
      ) : workers.data.length === 0 ? (
        <EmptyState icon={<CoinsIcon />} title={tc("empty")} />
      ) : (
        <>
          {stats.isError && <FormAlert>{t("statsFailed")}</FormAlert>}
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {workers.data.map((worker) => (
              <li key={worker.id}>
                <WorkerCard
                  worker={worker}
                  profile={worker.user_id ? profiles.data?.get(worker.user_id) : undefined}
                  stats={stats.data ? (stats.data.get(worker.id) ?? EMPTY_MONTH) : undefined}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
