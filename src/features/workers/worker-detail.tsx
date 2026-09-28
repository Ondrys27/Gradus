"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeftIcon,
  BanknoteIcon,
  ClockIcon,
  HourglassIcon,
  PencilIcon,
  PlusIcon,
  WalletIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Stagger, StaggerItem } from "@/components/ui/stagger";
import { StatTile } from "@/components/ui/stat-tile";
import { StatusPill } from "@/components/ui/status-pill";
import { Segmented } from "@/features/finance/segmented";
import { formatNumber, splitDuration, todayIsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { EarningsPanel } from "./earnings-panel";
import { InviteCard } from "./invite-card";
import { monthStartOf, permissionsFromRows } from "./logic";
import { PaymentDialog, PaymentsPanel } from "./payments";
import {
  useRenewInvite,
  useWorker,
  useWorkerBalance,
  useWorkerInvite,
  useWorkerMonthStats,
  useWorkerPermissions,
  useWorkerProfiles,
} from "./queries";
import { TimePanel } from "./time-panel";
import type { WorkerTask } from "./types";
import { WorkerFormDialog } from "./worker-form-dialog";
import { WorkerTaskDialog } from "./worker-task-dialog";
import { WorkerTaskList } from "./worker-task-list";

const TABS = ["tasks", "earnings", "payments", "time"] as const;
type Tab = (typeof TABS)[number];

const backLinkClass = cn(buttonVariants({ variant: "ghost", size: "sm" }), "self-start");

/** Everything about one worker: tasks, earnings, payments and time. */
export function WorkerDetail({ workerId }: { workerId: string }) {
  const t = useTranslations("workers");
  const settings = useFormatSettings();
  const worker = useWorker(workerId);
  const balance = useWorkerBalance(workerId);
  const stats = useWorkerMonthStats(monthStartOf(todayIsoDate(settings)));
  const permissions = useWorkerPermissions(workerId);
  const invited = worker.data?.status === "invited";
  const invite = useWorkerInvite(workerId, invited);
  const renew = useRenewInvite(workerId);
  const profiles = useWorkerProfiles(worker.data?.user_id ? [worker.data.user_id] : []);
  const [tab, setTab] = useState<Tab>("tasks");
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [taskDialog, setTaskDialog] = useState<{ open: boolean; task: WorkerTask | null }>({
    open: false,
    task: null,
  });

  const back = (
    <Link href="/workers" className={backLinkClass}>
      <ArrowLeftIcon aria-hidden data-icon="inline-start" />
      {t("back")}
    </Link>
  );

  if (worker.isError) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <FormAlert>{t("detail.loadFailed")}</FormAlert>
      </div>
    );
  }
  if (!worker.data) {
    if (worker.isPending) {
      return (
        <div className="flex flex-col gap-6" aria-hidden>
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-24 w-full rounded-card" />
          <Skeleton className="h-64 w-full rounded-card" />
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-6">
        {back}
        <EmptyState title={t("detail.notFoundTitle")} description={t("detail.notFoundDescription")} />
      </div>
    );
  }

  const data = worker.data;
  const month = stats.data?.get(workerId);
  const duration = splitDuration(month?.workSeconds ?? 0);
  const owed = balance.data?.owed ?? 0;
  const profile = data.user_id ? profiles.data?.get(data.user_id) : undefined;

  return (
    <Stagger className="flex flex-col gap-6">
      <StaggerItem>{back}</StaggerItem>
      <StaggerItem>
        <PageHeader
          title={data.name}
          eyebrow={data.job_title ?? undefined}
          description={
            <span className="flex flex-wrap items-center gap-3">
              <Avatar src={profile?.avatarUrl} name={data.name} className="size-10" />
              {data.email && <span className="text-sm">{data.email}</span>}
              {invited && <StatusPill tone="violet">{t("card.invited")}</StatusPill>}
            </span>
          }
          actions={
            <>
              <Button variant="outline" onClick={() => setEditing(true)} disabled={!permissions.data}>
                <PencilIcon aria-hidden data-icon="inline-start" />
                {t("detail.edit")}
              </Button>
              <Button onClick={() => setPaying(true)} disabled={!balance.data}>
                <BanknoteIcon aria-hidden data-icon="inline-start" />
                {t("payments.record")}
              </Button>
            </>
          }
        />
      </StaggerItem>

      {invited && invite.data && (
        <StaggerItem>
          <InviteCard
            invite={invite.data}
            workerName={data.name}
            onRenew={() => renew.mutate(data.email)}
            renewing={renew.isPending}
            renewFailed={renew.isError}
          />
        </StaggerItem>
      )}

      <StaggerItem>
        {balance.isError ? (
          <FormAlert>{t("detail.balanceFailed")}</FormAlert>
        ) : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
            <GlowTime
              label={t("detail.workedThisMonth")}
              value={t("card.duration", {
                hours: formatNumber(duration.hours, {}, settings),
                minutes: formatNumber(duration.minutes, {}, settings),
              })}
            />
          </div>
        )}
      </StaggerItem>

      <StaggerItem className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Segmented
            label={t("detail.sections")}
            value={tab}
            options={TABS.map((value) => ({ value, label: t(`detail.tab.${value}`) }))}
            onChange={setTab}
            panelId={(value) => `worker-panel-${value}`}
          />
          {tab === "tasks" && (
            <Button onClick={() => setTaskDialog({ open: true, task: null })}>
              <PlusIcon aria-hidden data-icon="inline-start" />
              {t("tasks.new")}
            </Button>
          )}
        </div>
        <div id={`worker-panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {tab === "tasks" && (
            <WorkerTaskList
              workerId={workerId}
              mode="owner"
              onOpen={(task) => setTaskDialog({ open: true, task })}
            />
          )}
          {tab === "earnings" && <EarningsPanel workerId={workerId} canApprove />}
          {tab === "payments" && <PaymentsPanel workerId={workerId} />}
          {tab === "time" && <TimePanel workerId={workerId} />}
        </div>
      </StaggerItem>

      <WorkerFormDialog
        open={editing}
        onOpenChange={setEditing}
        worker={data}
        permissions={permissions.data ? permissionsFromRows(permissions.data) : undefined}
      />
      <PaymentDialog open={paying} onOpenChange={setPaying} workerId={workerId} owed={owed} />
      <WorkerTaskDialog
        open={taskDialog.open}
        onOpenChange={(open) => setTaskDialog((current) => ({ ...current, open }))}
        workerId={workerId}
        task={taskDialog.task}
      />
    </Stagger>
  );
}

/** A tile for a duration, which is text rather than a counted number. */
function GlowTime({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-glow">
      <div className="flex items-center justify-between gap-3">
        <span className="micro-label">{label}</span>
        <span className="grid size-9 place-items-center rounded-xl border border-teal/30 bg-teal/10 text-teal [&_svg]:size-4.5">
          <ClockIcon aria-hidden />
        </span>
      </div>
      <span className="stat-number text-[clamp(24px,5vw,40px)] whitespace-nowrap text-ink">
        {value}
      </span>
    </div>
  );
}
