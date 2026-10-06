"use client";

import Link from "next/link";
import { ArrowRightIcon, ClockIcon, CoinsIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { PageHeader } from "@/components/ui/page-header";
import { Stagger, StaggerItem } from "@/components/ui/stagger";
import { StatTile } from "@/components/ui/stat-tile";
import { useProfile, useSession } from "@/features/account/queries";
import { formatCurrency, formatNumber, splitDuration, todayIsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { monthStartOf } from "../logic";
import { useOpenWorkerTasks, useWorkerMonthStats } from "../queries";
import { WorkTimerCard } from "./work-timer-card";

/** The worker's month: what they earned, how long they worked, and the timer. */
export function WorkerDashboard() {
  const t = useTranslations("workers.home");
  const { worker } = useSession();
  const profile = useProfile();
  const settings = useFormatSettings();
  const stats = useWorkerMonthStats(monthStartOf(todayIsoDate(settings)));
  const openTasks = useOpenWorkerTasks(worker?.id ?? null);
  if (!worker) return null;

  const month = stats.data?.get(worker.id);
  const worked = splitDuration(month?.workSeconds ?? 0);
  const name = profile.display_name || worker.name;

  return (
    <Stagger className="flex flex-col gap-8">
      <StaggerItem>
        <PageHeader title={t("title", { name })} description={t("description")} />
      </StaggerItem>

      {stats.isError && (
        <StaggerItem>
          <FormAlert>{t("loadFailed")}</FormAlert>
        </StaggerItem>
      )}

      <StaggerItem className="grid gap-4 md:grid-cols-2">
        <StatTile
          label={t("earnedThisMonth")}
          value={month?.earned ?? 0}
          format={{ style: "currency" }}
          tone="gold"
          icon={<CoinsIcon />}
          hint={
            month && month.pendingAmount > 0
              ? t("pendingHint", {
                  amount: formatCurrency(month.pendingAmount, undefined, settings),
                })
              : undefined
          }
        />
        <GlowCard className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="micro-label">{t("workedThisMonth")}</span>
            <span className="grid size-9 place-items-center rounded-xl border border-teal/30 bg-teal/10 text-teal [&_svg]:size-4.5">
              <ClockIcon aria-hidden />
            </span>
          </div>
          <span className="stat-number text-[clamp(24px,6vw,40px)] whitespace-nowrap text-ink">
            {t("duration", {
              hours: formatNumber(worked.hours, {}, settings),
              minutes: formatNumber(worked.minutes, {}, settings),
            })}
          </span>
        </GlowCard>
      </StaggerItem>

      <StaggerItem className="grid gap-4 lg:grid-cols-2">
        <WorkTimerCard workerId={worker.id} />
        <GlowCard interactive={false} className="flex flex-col gap-3">
          <h2 className="micro-label">{t("tasksTitle")}</h2>
          <p className="text-3xl font-bold text-ink tabular-nums">
            {formatNumber(openTasks.data?.length ?? 0, {}, settings)}
          </p>
          <p className="text-sm text-ink-soft">
            {t("openTasks", { count: openTasks.data?.length ?? 0 })}
          </p>
          <Link href="/app/ukoly" className={buttonVariants({ variant: "outline", className: "mt-auto self-start" })}>
            {t("toTasks")}
            <ArrowRightIcon aria-hidden data-icon="inline-end" />
          </Link>
        </GlowCard>
      </StaggerItem>
    </Stagger>
  );
}
