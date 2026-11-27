"use client";

import { useMemo, useState } from "react";
import { PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/features/account/workspace-queries";
import { todayIsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { AddRewardDialog, type LinkOption } from "../rewards/entry-dialogs";
import { MyRewards } from "../rewards/my-rewards";
import { PayoutsPanel } from "../rewards/payouts-panel";
import { PlanCard } from "../rewards/plan-card";
import { useManagesRewards, useRewardPlan, useRewardTotals } from "../rewards/queries";
import { RewardsTiles } from "../rewards/rewards-tiles";
import { WorkTable } from "../rewards/work-table";
import { TimePanel } from "../time-panel";
import { horizonRange } from "./chart-logic";
import type { DashboardViewer, DashboardWorker } from "./types";
import { useWorkerDeals, useWorkerTasks } from "./work-queries";

/**
 * Rewards of one person (28.2). Whoever manages them (the owner, or "company:
 * rewards") sees the month at a glance, adds a reward by hand, builds the
 * plan, approves the work and pays out; the person sees their own, read only.
 */
export function RewardsTab({
  worker,
  viewer,
}: {
  worker: DashboardWorker;
  viewer: DashboardViewer;
}) {
  const manages = useManagesRewards();
  if (viewer === "self") return <MyRewards workerId={worker.id} />;
  if (!manages) return null;
  return <ManagedRewards worker={worker} />;
}

function ManagedRewards({ worker }: { worker: DashboardWorker }) {
  const t = useTranslations("workers.rewardPlan");
  const settings = useFormatSettings();
  const workspace = useWorkspace();
  const plan = useRewardPlan(worker.id);
  const totals = useRewardTotals(worker.id);
  const [adding, setAdding] = useState(false);
  const links = useLinkOptions(worker, adding);
  const currency = plan.data?.currency ?? settings.currency;
  const canChange = !workspace.readOnly;

  return (
    <div className="flex flex-col gap-5" data-testid="worker-rewards">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-sm text-ink-soft">{t("intro")}</p>
        {canChange && worker.status !== "inactive" && (
          <Button onClick={() => setAdding(true)} data-testid="reward-add" data-tutorial="reward-add">
            <PlusIcon aria-hidden data-icon="inline-start" />
            {t("add.button")}
          </Button>
        )}
      </div>
      <RewardsTiles totals={totals.data} isError={totals.isError} currency={currency} />
      {/* Somebody who left keeps their history; their plan gets nothing new (28.1). */}
      <PlanCard
        workerId={worker.id}
        editable
        readOnly={workspace.readOnly || worker.status === "inactive"}
      />
      <WorkTable worker={worker} canReview={canChange} />
      <PayoutsPanel workerId={worker.id} name={worker.name} canPay={canChange} />
      <details className="rounded-card border border-line bg-surface px-5 py-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-ink outline-none">
          {t("time")}
        </summary>
        <div className="pt-3 pb-2">
          <TimePanel workerId={worker.id} />
        </div>
      </details>
      <AddRewardDialog
        open={adding}
        onOpenChange={setAdding}
        workerId={worker.id}
        currency={currency}
        links={links}
      />
    </div>
  );
}

/** This month's tasks and the open or won deals of the person, to hang a reward on. */
function useLinkOptions(worker: DashboardWorker, enabled: boolean): LinkOption[] {
  const settings = useFormatSettings();
  const range = horizonRange({ kind: "month" }, todayIsoDate(settings), settings);
  // The same queries as the work table below: read once.
  const tasks = useWorkerTasks(worker.id, worker.userId, range);
  const deals = useWorkerDeals(worker.id, worker.userId);
  return useMemo(() => {
    if (!enabled) return [];
    const options: LinkOption[] = (tasks.data ?? []).map((task) => ({
      value: `task-${task.id}`,
      label: task.title,
      link: { kind: task.origin === "crm" ? "crm_task" : "worker_task", id: task.id },
    }));
    for (const deal of deals.data ?? []) {
      if (deal.lost_at) continue;
      options.push({ value: `deal-${deal.id}`, label: deal.title, link: { kind: "deal", id: deal.id } });
    }
    return options.slice(0, 200);
  }, [enabled, tasks.data, deals.data]);
}
