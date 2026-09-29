"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeftIcon,
  CalendarIcon,
  CheckCircle2Icon,
  FlagIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressRing } from "@/components/ui/progress-ring";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { formatCalendarDate, formatNumber, todayIsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MilestoneFormDialog } from "./milestone-form-dialog";
import { JarvisBot } from "@/components/jarvis/jarvis-bot";
import { useCelebration } from "@/components/celebration/celebration-provider";
import { useAwardXp } from "@/features/gamification/queries";
import {
  useDeleteMilestone,
  useMilestone,
  useMilestoneReviewPending,
  useSetMilestoneStatus,
  useTasks,
} from "./queries";
import { countTasks, progressOf } from "./task-tree";
import { TasksPanel } from "./tasks-panel";

const RING_SIZE = 220;

export function MilestoneDetail({ id }: { id: string }) {
  const t = useTranslations("milestones");
  const router = useRouter();
  const settings = useFormatSettings();
  const milestoneQuery = useMilestone(id);
  const tasksQuery = useTasks(id);
  const setStatus = useSetMilestoneStatus(id);
  const remove = useDeleteMilestone(id);
  const reviewing = useMilestoneReviewPending(id);
  const { celebrate } = useCelebration();
  const awardXp = useAwardXp();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function complete() {
    setStatus.mutate("completed", {
      onSuccess: (row) => {
        awardXp.mutate(
          { kind: "milestone_completed", idempotencyKey: row.id },
          {
            onSuccess: ({ awarded, xp }) =>
              celebrate({ title: t("celebration.title"), subtitle: row.title, xp: awarded ? xp : undefined }),
          },
        );
      },
    });
  }

  const backLink = (
    <Link href="/milestones" className={buttonVariants({ variant: "ghost", size: "sm" })}>
      <ArrowLeftIcon aria-hidden data-icon="inline-start" />
      {t("backToList")}
    </Link>
  );

  if (milestoneQuery.isPending || tasksQuery.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-72 rounded-card" />
        <Skeleton className="h-64 rounded-card" />
      </div>
    );
  }

  if (milestoneQuery.isError || tasksQuery.isError) {
    return (
      <EmptyState
        icon={<FlagIcon />}
        title={t("loadFailed")}
        action={
          <Button
            variant="outline"
            onClick={() => {
              void milestoneQuery.refetch();
              void tasksQuery.refetch();
            }}
          >
            {t("retry")}
          </Button>
        }
      />
    );
  }

  const milestone = milestoneQuery.data;
  if (!milestone) {
    return (
      <EmptyState
        icon={<FlagIcon />}
        title={t("notFound.title")}
        description={t("notFound.description")}
        action={
          <Link href="/milestones" className={buttonVariants()}>
            {t("notFound.action")}
          </Link>
        }
      />
    );
  }

  const tasks = tasksQuery.data;
  const counts = countTasks(tasks);
  const ratio = progressOf(counts);
  const completed = milestone.status === "completed";
  const allDone = !completed && counts.total > 0 && counts.done === counts.total;
  const overdue =
    !completed && !!milestone.target_date && milestone.target_date < todayIsoDate(settings);

  return (
    <div className="flex flex-col gap-6">
      <div className="-ml-2">{backLink}</div>

      <PageHeader
        title={milestone.title}
        description={milestone.description ?? undefined}
        actions={
          <>
            <Button variant="outline" onClick={() => setEditing(true)}>
              <PencilIcon aria-hidden data-icon="inline-start" />
              {t("actions.edit")}
            </Button>
            <Button variant="outline" onClick={() => setDeleting(true)}>
              <Trash2Icon aria-hidden data-icon="inline-start" />
              {t("actions.delete")}
            </Button>
            {completed ? (
              <Button disabled={setStatus.isPending} onClick={() => setStatus.mutate("active")}>
                <RotateCcwIcon aria-hidden data-icon="inline-start" />
                {t("actions.reopen")}
              </Button>
            ) : (
              <Button
                variant={allDone ? "default" : "outline"}
                disabled={setStatus.isPending}
                onClick={complete}
              >
                <CheckCircle2Icon aria-hidden data-icon="inline-start" />
                {t("actions.complete")}
              </Button>
            )}
          </>
        }
      />

      {setStatus.isError && <FormAlert>{t("detail.statusFailed")}</FormAlert>}

      <GlowCard
        interactive={false}
        className="flex flex-col items-center gap-6 md:flex-row md:gap-10 md:p-8"
      >
        <ProgressRing
          size={RING_SIZE}
          strokeWidth={14}
          value={counts.done}
          max={counts.total}
          label={t("detail.progress")}
          tone={completed ? "green" : "teal"}
        >
          <AnimatedNumber
            value={ratio}
            format={{ style: "percent" }}
            className="text-4xl font-bold tabular-nums"
          />
        </ProgressRing>

        <div className="flex min-w-0 flex-1 flex-col gap-4 self-stretch">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={milestone.category === "work" ? "violet" : "teal"}>
              {t(`category.${milestone.category}`)}
            </StatusPill>
            {milestone.tag && <StatusPill>{milestone.tag}</StatusPill>}
            {milestone.target_date && (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 text-sm text-ink-muted",
                  overdue && "text-pink",
                )}
              >
                <CalendarIcon aria-hidden className="size-4" />
                {t(overdue ? "card.overdue" : "card.due", {
                  date: formatCalendarDate(milestone.target_date, settings),
                })}
              </span>
            )}
          </div>

          <p className="text-sm text-ink-soft">
            {counts.total > 0
              ? t("detail.tasksDone", { done: counts.done, total: counts.total })
              : t("card.noTasks")}
          </p>

          <dl className="grid grid-cols-3 gap-3">
            {(
              [
                ["done", counts.done, "text-green"],
                ["inProgress", counts.inProgress, "text-gold"],
                ["todo", counts.total - counts.done - counts.inProgress, "text-ink"],
              ] as const
            ).map(([key, value, color]) => (
              <div key={key} className="rounded-xl border border-line bg-canvas-deep/40 p-3">
                <dt className="micro-label">{t(`detail.stats.${key}`)}</dt>
                <dd className={cn("mt-1 text-2xl font-bold tabular-nums", color)}>
                  {formatNumber(value, {}, settings)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </GlowCard>

      {(milestone.ai_feedback || reviewing) && (
        <GlowCard interactive={false} className="flex items-start gap-3 border-teal/40">
          <JarvisBot size={36} state={reviewing ? "thinking" : "idle"} />
          <div className="min-w-0 flex-1">
            <p className="micro-label">{t("detail.jarvisFeedback")}</p>
            <p
              aria-live="polite"
              className="mt-1 text-sm leading-relaxed whitespace-pre-wrap text-ink-soft"
            >
              {milestone.ai_feedback ?? t("detail.jarvisReviewing")}
            </p>
          </div>
        </GlowCard>
      )}

      {allDone && (
        <GlowCard
          interactive={false}
          className="flex flex-col gap-3 border-gold/40 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="font-semibold text-ink">{t("detail.offerTitle")}</p>
            <p className="text-sm text-ink-soft">{t("detail.offerDescription")}</p>
          </div>
          <Button disabled={setStatus.isPending} onClick={complete}>
            <CheckCircle2Icon aria-hidden data-icon="inline-start" />
            {t("actions.complete")}
          </Button>
        </GlowCard>
      )}

      {completed && (
        <GlowCard interactive={false} className="border-green/40">
          <p className="font-semibold text-green">{t("detail.completedTitle")}</p>
          <p className="text-sm text-ink-soft">{t("detail.completedDescription")}</p>
        </GlowCard>
      )}

      <TasksPanel milestone={milestone} tasks={tasks} />

      <MilestoneFormDialog open={editing} onOpenChange={setEditing} milestone={milestone} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t("delete.title")}
        description={t("delete.description", { title: milestone.title, count: counts.total })}
        confirmLabel={t("delete.confirm")}
        cancelLabel={t("delete.cancel")}
        closeLabel={t("form.close")}
        pending={remove.isPending}
        error={remove.isError ? t("delete.failed") : null}
        onConfirm={() =>
          remove.mutate(undefined, { onSuccess: () => router.replace("/milestones") })
        }
      />
    </div>
  );
}
