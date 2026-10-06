"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { CalendarDaysIcon, CircleCheckIcon, HandshakeIcon, PhoneCallIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { useCalendarEvents } from "@/features/calendar/queries";
import { TaskCheckbox } from "@/features/milestones/task-checkbox";
import { formatNumber, formatTime } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import type { DayCounts } from "./dashboard-logic";
import {
  useFollowUpsDue,
  useStalledDeals,
  useToday,
  useTodayTasks,
  useToggleDashTask,
  type DashTask,
} from "./queries";

const DAY_MS = 86_400_000;
/** The card lists a few of each; the rest are one tap away in their own section. */
const SHOWN_PER_SECTION = 5;

/** Everything the day holds, for the sentence under the greeting and the card. */
export function useTodayOverview() {
  const { today, timeZone } = useToday();
  const tasks = useTodayTasks();
  const events = useCalendarEvents(today, today, timeZone, true);
  const followUps = useFollowUpsDue();
  const stalled = useStalledDeals();

  const queries = [tasks, events, followUps, stalled];
  const counts: DayCounts = {
    tasks: tasks.data?.openTotal ?? 0,
    events: events.data?.length ?? 0,
    followUps: followUps.data?.length ?? 0,
    deals: stalled.data?.total ?? 0,
  };
  return {
    tasks,
    events,
    followUps,
    stalled,
    counts,
    pending: queries.some((query) => query.isPending),
    failed: queries.some((query) => query.isError),
  };
}

type Overview = ReturnType<typeof useTodayOverview>;

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: ReactNode;
  title: string;
  count: number;
  children: ReactNode;
}) {
  const settings = useFormatSettings();
  return (
    <section className="flex flex-col gap-1">
      <h3 className="flex items-center gap-2 text-ink-muted [&_svg]:size-4">
        {icon}
        <span className="micro-label">{title}</span>
        <span className="micro-label tabular-nums">{formatNumber(count, {}, settings)}</span>
      </h3>
      <ul className="flex flex-col">{children}</ul>
    </section>
  );
}

const rowLink =
  "min-w-0 flex-1 rounded-md py-1 text-sm text-ink outline-none hover:text-violet focus-visible:ring-3 focus-visible:ring-violet/40";

function TaskRow({
  task,
  today,
  onToggle,
}: {
  task: DashTask;
  today: string;
  onToggle: () => void;
}) {
  const t = useTranslations("dashboard.today");
  const done = task.status === "done";
  const overdue = !done && task.due_date !== null && task.due_date < today;
  return (
    <li className="flex min-h-11 items-center gap-3 py-1">
      <TaskCheckbox
        title={task.title}
        done={done}
        remaining={task.openSubtasks}
        onToggle={onToggle}
      />
      <Link
        href={`/app/milniky/${task.milestone_id}`}
        className={cn(rowLink, done && "text-ink-muted line-through")}
      >
        <span className="block truncate">{task.title}</span>
        {task.milestoneTitle && (
          <span className="block truncate text-xs text-ink-muted">{task.milestoneTitle}</span>
        )}
      </Link>
      {overdue && <StatusPill tone="pink">{t("overdue")}</StatusPill>}
    </li>
  );
}

export function TodayCard({ overview }: { overview: Overview }) {
  const t = useTranslations("dashboard.today");
  const settings = useFormatSettings();
  const { today, from } = useToday();
  const toggle = useToggleDashTask();
  const [saveFailed, setSaveFailed] = useState(false);
  const { tasks, events, followUps, stalled, counts } = overview;

  const openTasks = (tasks.data?.open ?? []).slice(0, SHOWN_PER_SECTION);
  const hiddenTasks = counts.tasks - openTasks.length;
  const doneTasks = tasks.data?.done ?? [];
  const taskRows = [...openTasks, ...doneTasks];
  const eventRows = events.data ?? [];
  const followUpRows = followUps.data ?? [];
  const stalledRows = stalled.data?.deals ?? [];
  const nothing =
    taskRows.length === 0 &&
    eventRows.length === 0 &&
    followUpRows.length === 0 &&
    stalledRows.length === 0;
  const now = Date.now();

  return (
    <GlowCard interactive={false} className="flex flex-col gap-5">
      <h2 className="text-lg font-semibold text-ink">{t("title")}</h2>

      {saveFailed && <FormAlert>{t("saveFailed")}</FormAlert>}
      {overview.failed && <FormAlert>{t("loadFailed")}</FormAlert>}

      {overview.pending ? (
        <div className="flex flex-col gap-3" aria-hidden>
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-11 w-full" />
          ))}
        </div>
      ) : nothing ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <span className="grid size-12 place-items-center rounded-2xl border border-green/30 bg-green/10 text-green">
            <CircleCheckIcon aria-hidden className="size-6" />
          </span>
          <p className="font-semibold text-ink">{t("emptyTitle")}</p>
          <p className="max-w-xs text-sm text-pretty text-ink-muted">{t("emptyDescription")}</p>
        </div>
      ) : (
        <>
          {taskRows.length > 0 && (
            <Section icon={<CircleCheckIcon aria-hidden />} title={t("tasks")} count={counts.tasks}>
              {taskRows.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  today={today}
                  onToggle={() => {
                    setSaveFailed(false);
                    toggle.mutate(
                      { task, done: task.status !== "done" },
                      { onError: () => setSaveFailed(true) },
                    );
                  }}
                />
              ))}
              {hiddenTasks > 0 && (
                <li>
                  <Link
                    href="/app/milniky"
                    className="inline-flex min-h-11 items-center text-sm text-violet outline-none hover:underline focus-visible:ring-3 focus-visible:ring-violet/40"
                  >
                    {t("moreTasks", {
                      count: hiddenTasks,
                      formatted: formatNumber(hiddenTasks, {}, settings),
                    })}
                  </Link>
                </li>
              )}
            </Section>
          )}

          {eventRows.length > 0 && (
            <Section
              icon={<CalendarDaysIcon aria-hidden />}
              title={t("events")}
              count={eventRows.length}
            >
              {eventRows.slice(0, SHOWN_PER_SECTION).map((event) => (
                <li key={event.id} className="flex min-h-11 items-center gap-3 py-1">
                  <span className="w-14 shrink-0 text-sm text-ink-muted tabular-nums">
                    {event.all_day ? t("allDay") : formatTime(new Date(event.starts_at), settings)}
                  </span>
                  <Link href="/app/kalendar" className={rowLink}>
                    <span className="block truncate">{event.title}</span>
                  </Link>
                </li>
              ))}
            </Section>
          )}

          {followUpRows.length > 0 && (
            <Section
              icon={<PhoneCallIcon aria-hidden />}
              title={t("followUps")}
              count={followUpRows.length}
            >
              {followUpRows.slice(0, SHOWN_PER_SECTION).map((entry) => (
                <li key={entry.entryId} className="flex min-h-11 items-center gap-3 py-1">
                  <span className="w-14 shrink-0 text-sm text-ink-muted tabular-nums">
                    {formatTime(entry.dueAt, settings)}
                  </span>
                  <Link href={`/app/kontakty/${entry.contactId}`} className={rowLink}>
                    <span className="block truncate">{entry.name || t("unnamedContact")}</span>
                  </Link>
                  {entry.dueAt.toISOString() < from && (
                    <StatusPill tone="pink">{t("overdue")}</StatusPill>
                  )}
                </li>
              ))}
            </Section>
          )}

          {stalledRows.length > 0 && (
            <Section
              icon={<HandshakeIcon aria-hidden />}
              title={t("stalledDeals")}
              count={counts.deals}
            >
              {stalledRows.map((deal) => {
                const days = Math.floor((now - Date.parse(deal.entered_stage_at)) / DAY_MS);
                return (
                  <li key={deal.id} className="flex min-h-11 items-center gap-3 py-1">
                    <Link href={`/app/pipeline?deal=${deal.id}`} className={rowLink}>
                      <span className="block truncate">{deal.title}</span>
                    </Link>
                    <span className="shrink-0 text-xs text-gold tabular-nums">
                      {t("daysInStage", {
                        count: days,
                        formatted: formatNumber(days, {}, settings),
                      })}
                    </span>
                  </li>
                );
              })}
            </Section>
          )}
        </>
      )}
    </GlowCard>
  );
}
