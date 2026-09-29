"use client";

import Link from "next/link";
import { CalendarIcon, CheckCircle2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { GlowCard } from "@/components/ui/glow-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusPill } from "@/components/ui/status-pill";
import { formatCalendarDate, formatNumber, todayIsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { progressOf } from "./task-tree";
import type { MilestoneWithCounts } from "./types";

export function MilestoneCard({ milestone }: { milestone: MilestoneWithCounts }) {
  const t = useTranslations("milestones");
  const settings = useFormatSettings();
  const completed = milestone.status === "completed";
  const ratio = progressOf(milestone);
  const overdue =
    !completed && !!milestone.target_date && milestone.target_date < todayIsoDate(settings);
  const remaining = milestone.total - milestone.done;
  // A nudge once most of the tasks are done, so the last stretch feels close, not far.
  const almostThere = !completed && milestone.total >= 4 && ratio >= 0.8 && remaining > 0;

  return (
    <Link
      href={`/milestones/${milestone.id}`}
      className="block rounded-card outline-none focus-visible:ring-3 focus-visible:ring-violet/40"
    >
      <GlowCard className={cn("flex flex-col gap-4", completed && "opacity-60")}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 text-lg font-semibold break-words text-ink">{milestone.title}</h2>
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            <StatusPill tone={milestone.category === "work" ? "violet" : "teal"}>
              {t(`category.${milestone.category}`)}
            </StatusPill>
            {milestone.tag && <StatusPill>{milestone.tag}</StatusPill>}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <ProgressBar
            className="h-3.5"
            value={ratio}
            max={1}
            label={t("card.progress", { title: milestone.title })}
          />
          <span className="w-12 shrink-0 text-right text-sm font-semibold text-teal tabular-nums">
            {formatNumber(ratio, { style: "percent" }, settings)}
          </span>
        </div>

        {almostThere && (
          <p className="text-sm font-medium text-teal">{t("card.almostThere", { remaining })}</p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-ink-muted">
          <span>
            {milestone.total > 0
              ? t("card.tasksCount", { done: milestone.done, total: milestone.total })
              : t("card.noTasks")}
          </span>
          {completed ? (
            <span className="inline-flex items-center gap-1.5 text-green">
              <CheckCircle2Icon aria-hidden className="size-4" />
              {t("card.completed")}
            </span>
          ) : milestone.target_date ? (
            <span className={cn("inline-flex items-center gap-1.5", overdue && "text-pink")}>
              <CalendarIcon aria-hidden className="size-4" />
              {t(overdue ? "card.overdue" : "card.due", {
                date: formatCalendarDate(milestone.target_date, settings),
              })}
            </span>
          ) : (
            <span>{t("card.noDate")}</span>
          )}
        </div>
      </GlowCard>
    </Link>
  );
}
