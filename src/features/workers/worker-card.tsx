"use client";

import Link from "next/link";
import { ClockIcon, CoinsIcon, HourglassIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { GlowCard } from "@/components/ui/glow-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { formatCurrency, formatNumber, splitDuration } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { taskProgress } from "./logic";
import type { Worker, WorkerMonthStats, WorkerProfile } from "./types";

type Props = {
  worker: Worker;
  profile: WorkerProfile | undefined;
  /** Undefined while the month is loading. */
  stats: WorkerMonthStats | undefined;
};

/** One worker at a glance: this month's tasks, hours and earnings, and what waits for approval. */
export function WorkerCard({ worker, profile, stats }: Props) {
  const t = useTranslations("workers.card");
  const settings = useFormatSettings();
  const invited = worker.status === "invited";
  const duration = splitDuration(stats?.workSeconds ?? 0);

  return (
    <Link
      href={`/app/pracovnici/${worker.id}`}
      className="block rounded-card outline-none focus-visible:ring-3 focus-visible:ring-violet/40"
    >
      <GlowCard className="flex h-full flex-col gap-4">
        <div className="flex items-start gap-3">
          <Avatar
            src={profile?.avatarUrl}
            name={worker.name}
            className="size-12 text-base"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate font-semibold text-ink">{worker.name}</span>
            <span className="truncate text-sm text-ink-muted">
              {worker.job_title ?? t("noJobTitle")}
            </span>
          </div>
          {invited ? (
            <StatusPill tone="violet">{t("invited")}</StatusPill>
          ) : worker.status === "inactive" ? (
            <StatusPill>{t("inactive")}</StatusPill>
          ) : stats && stats.pendingCount > 0 ? (
            <StatusPill tone="gold" dot>
              {t("pending", {
                count: stats.pendingCount,
                shown: formatNumber(stats.pendingCount, {}, settings),
              })}
            </StatusPill>
          ) : null}
        </div>

        {!stats ? (
          <div className="flex flex-col gap-3" aria-hidden>
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-ink-soft">
                <span>{t("tasksThisMonth")}</span>
                <span className="tabular-nums">
                  {t("tasksDone", {
                    done: formatNumber(stats.tasksDone, {}, settings),
                    total: formatNumber(stats.tasksTotal, {}, settings),
                  })}
                </span>
              </div>
              <ProgressBar
                value={taskProgress(stats.tasksDone, stats.tasksTotal)}
                max={1}
                size="sm"
                label={t("tasksThisMonth")}
              />
            </div>
            <dl className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <dt className="flex items-center gap-1.5 text-xs text-ink-muted">
                  <ClockIcon aria-hidden className="size-3.5" />
                  {t("hours")}
                </dt>
                <dd className="text-lg font-semibold text-ink tabular-nums">
                  {t("duration", {
                    hours: formatNumber(duration.hours, {}, settings),
                    minutes: formatNumber(duration.minutes, {}, settings),
                  })}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="flex items-center gap-1.5 text-xs text-ink-muted">
                  <CoinsIcon aria-hidden className="size-3.5" />
                  {t("earned")}
                </dt>
                <dd className="text-lg font-semibold text-gold tabular-nums">
                  {formatCurrency(stats.earned, undefined, settings)}
                </dd>
              </div>
            </dl>
            {stats.pendingAmount > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-gold/90">
                <HourglassIcon aria-hidden className="size-3.5" />
                {t("pendingAmount", {
                  amount: formatCurrency(stats.pendingAmount, undefined, settings),
                })}
              </p>
            )}
          </>
        )}
      </GlowCard>
    </Link>
  );
}
