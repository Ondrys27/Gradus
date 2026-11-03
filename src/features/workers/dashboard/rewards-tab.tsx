"use client";

import { useState } from "react";
import { BanknoteIcon, ClockIcon, HourglassIcon, WalletIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { StatTile } from "@/components/ui/stat-tile";
import { useWorkspace } from "@/features/account/workspace-queries";
import { Segmented } from "@/features/finance/segmented";
import { formatNumber, splitDuration, todayIsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { EarningsPanel } from "../earnings-panel";
import { monthStartOf } from "../logic";
import { PaymentDialog, PaymentsPanel } from "../payments";
import { useWorkerBalance, useWorkerMonthStats } from "../queries";
import { TimePanel } from "../time-panel";
import type { WorkerTask } from "../types";
import { WorkerTaskDialog } from "../worker-task-dialog";
import { WorkerTaskList } from "../worker-task-list";
import type { DashboardViewer, DashboardWorker } from "./types";

const PANELS = ["earnings", "payments", "time", "tasks"] as const;
type Panel = (typeof PANELS)[number];

/**
 * Earnings, payouts and time. The owner approves and pays; the person sees
 * their own earnings, read only.
 */
export function RewardsTab({
  worker,
  viewer,
}: {
  worker: DashboardWorker;
  viewer: DashboardViewer;
}) {
  if (viewer === "owner") return <OwnerRewards worker={worker} />;
  return <EarningsPanel workerId={worker.id} canApprove={false} />;
}

function OwnerRewards({ worker }: { worker: DashboardWorker }) {
  const t = useTranslations("workers");
  const settings = useFormatSettings();
  const workspace = useWorkspace();
  const balance = useWorkerBalance(worker.id);
  const stats = useWorkerMonthStats(monthStartOf(todayIsoDate(settings)));
  const [panel, setPanel] = useState<Panel>("earnings");
  const [paying, setPaying] = useState(false);
  const [task, setTask] = useState<{ open: boolean; task: WorkerTask | null }>({
    open: false,
    task: null,
  });
  const month = stats.data?.get(worker.id);
  const duration = splitDuration(month?.workSeconds ?? 0);
  const owed = balance.data?.owed ?? 0;

  return (
    <div className="flex flex-col gap-5" data-testid="worker-rewards">
      {balance.isError ? (
        <FormAlert>{t("detail.balanceFailed")}</FormAlert>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label={t("detail.owed")}
            value={owed}
            format={{ style: "currency" }}
            tone="gold"
            icon={<WalletIcon />}
          />
          <StatTile
            label={t("detail.paidOut")}
            value={balance.data?.paidOut ?? 0}
            format={{ style: "currency" }}
            tone="green"
            icon={<BanknoteIcon />}
          />
          <StatTile
            label={t("detail.pending")}
            value={balance.data?.pending ?? 0}
            format={{ style: "currency" }}
            tone="violet"
            icon={<HourglassIcon />}
          />
          <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-glow">
            <div className="flex items-center justify-between gap-3">
              <span className="micro-label">{t("detail.workedThisMonth")}</span>
              <span className="grid size-9 place-items-center rounded-xl border border-teal/30 bg-teal/10 text-teal [&_svg]:size-4.5">
                <ClockIcon aria-hidden />
              </span>
            </div>
            <span className="stat-number text-[clamp(22px,4vw,32px)] whitespace-nowrap text-ink">
              {t("card.duration", {
                hours: formatNumber(duration.hours, {}, settings),
                minutes: formatNumber(duration.minutes, {}, settings),
              })}
            </span>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented
          label={t("detail.sections")}
          value={panel}
          options={PANELS.map((value) => ({ value, label: t(`detail.tab.${value}`) }))}
          onChange={setPanel}
          panelId={(value) => `worker-rewards-${value}`}
        />
        {!workspace.readOnly && (
          <Button onClick={() => setPaying(true)} disabled={!balance.data}>
            <BanknoteIcon aria-hidden data-icon="inline-start" />
            {t("payments.record")}
          </Button>
        )}
      </div>
      <div id={`worker-rewards-${panel}`} role="tabpanel" aria-labelledby={`tab-${panel}`}>
        {panel === "earnings" && <EarningsPanel workerId={worker.id} canApprove />}
        {panel === "payments" && <PaymentsPanel workerId={worker.id} />}
        {panel === "time" && <TimePanel workerId={worker.id} />}
        {panel === "tasks" && (
          <WorkerTaskList
            workerId={worker.id}
            mode="owner"
            onOpen={(open) => setTask({ open: true, task: open })}
          />
        )}
      </div>
      <WorkerTaskDialog
        open={task.open}
        onOpenChange={(open) => setTask((current) => ({ ...current, open }))}
        workerId={worker.id}
        task={task.task}
      />
      <PaymentDialog open={paying} onOpenChange={setPaying} workerId={worker.id} owed={owed} />
    </div>
  );
}
