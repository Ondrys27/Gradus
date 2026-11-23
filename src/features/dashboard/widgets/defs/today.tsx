"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  CalendarDaysIcon,
  CircleCheckIcon,
  HandshakeIcon,
  InboxIcon,
  PhoneCallIcon,
  SunIcon,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toneSoft, toneText, type Tone } from "@/components/ui/tone";
import { useSession } from "@/features/account/queries";
import { useCan } from "@/features/account/workspace-queries";
import { addDaysIso, viewDays } from "@/features/calendar/calendar-logic";
import { useCalendarEvents } from "@/features/calendar/queries";
import type { CalendarEvent } from "@/features/calendar/types";
import { DEFAULT_FILTERS } from "@/features/crm-tasks/logic";
import { useOpenTasks } from "@/features/crm-tasks/queries";
import type { CrmTask } from "@/features/crm-tasks/types";
import { taskCompletionRate } from "@/features/dashboard/dashboard-logic";
import {
  useToday,
  useTodayTasks,
  useToggleDashTask,
  type DashTask,
} from "@/features/dashboard/queries";
import { TasksDetail } from "@/features/dashboard/tile-detail";
import { TodayCard, useTodayOverview } from "@/features/dashboard/today-card";
import { useWaitingItems, WaitingForYou } from "@/features/dashboard/waiting-for-you";
import { CallWindowNotice } from "@/features/grady/call-window";
import { TaskCheckbox } from "@/features/milestones/task-checkbox";
import {
  formatNumber,
  formatTime,
  formatWeekdayShort,
  isoDateToLocal,
  localToIsoDate,
  toZonedWallClock,
  type IsoDate,
} from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { QUICK_ACTIONS } from "../catalog";
import {
  Actions,
  Columns,
  combine,
  defineWidget,
  DetailHeading,
  Empty,
  Hero,
  Legend,
  LiveNumber,
  MiniCalendar,
  Ring,
  Row,
  RowList,
  Side,
  Stack,
  Sub,
  type WidgetQuery,
  type WidgetSettings,
} from "../kit";

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Shared pieces: days in the user's zone, ticking a milestone task on the board
// ---------------------------------------------------------------------------

function dayOf(instant: string, timeZone: string): IsoDate {
  return localToIsoDate(toZonedWallClock(new Date(instant), timeZone));
}

/** Whole days from `from` to `to` (both calendar days of the user's zone). */
function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((isoDateToLocal(to).getTime() - isoDateToLocal(from).getTime()) / DAY_MS);
}

/** "today 13:00", "tomorrow 9:00", "Wed 13:00" from one set of keys. */
function useWhenLabel(namespace: "dashboard.widgets.meetings" | "dashboard.widgets.calendarWeek") {
  const t = useTranslations(namespace);
  const settings = useFormatSettings();
  const locale = useLocale();
  const { today, timeZone } = useToday();
  const timeOf = (event: Pick<CalendarEvent, "starts_at" | "all_day">) =>
    event.all_day ? t("allDay") : formatTime(new Date(event.starts_at), settings);
  const dayLabel = (day: IsoDate) =>
    day === today
      ? t("today")
      : day === addDaysIso(today, 1)
        ? t("tomorrow")
        : `${formatWeekdayShort(isoDateToLocal(day), locale)} ${formatNumber(isoDateToLocal(day).getDate(), {}, settings)}.`;
  const when = (event: Pick<CalendarEvent, "starts_at" | "all_day">) => {
    const day = dayOf(event.starts_at, timeZone);
    const time = timeOf(event);
    if (day === today) return t("todayAt", { time });
    if (day === addDaysIso(today, 1)) return t("tomorrowAt", { time });
    return `${formatWeekdayShort(isoDateToLocal(day), locale)} ${time}`;
  };
  return { when, timeOf, dayLabel, today, timeZone };
}

/** Ticks a task from the widget; the list changes at once, the error shows under it. */
function useTaskTick() {
  const toggle = useToggleDashTask();
  const [failed, setFailed] = useState(false);
  const tick = (task: DashTask) => {
    setFailed(false);
    toggle.mutate(
      { task, done: task.status !== "done" },
      { onError: () => setFailed(true) },
    );
  };
  return { tick, failed };
}

/** Open tasks first, then today's done ones (struck through) up to the limit. */
function pickTaskRows(open: DashTask[], done: DashTask[], limit: number): DashTask[] {
  const shown = open.slice(0, limit);
  return [...shown, ...done.slice(0, Math.max(0, limit - shown.length))];
}

function TaskRows({
  tasks,
  onTick,
  failed,
}: {
  tasks: DashTask[];
  onTick: (task: DashTask) => void;
  failed: boolean;
}) {
  const t = useTranslations("dashboard.today");
  const { today } = useToday();
  return (
    <ul className="flex min-h-0 flex-col divide-y divide-line overflow-hidden">
      {tasks.map((task) => {
        const done = task.status === "done";
        const overdue = !done && task.due_date !== null && task.due_date < today;
        return (
          <li key={task.id} className="flex min-h-9 items-center gap-2.5">
            <span data-no-open="" className="flex shrink-0">
              <TaskCheckbox
                title={task.title}
                done={done}
                remaining={task.openSubtasks}
                onToggle={() => onTick(task)}
              />
            </span>
            <Link
              href={`/app/milniky/${task.milestone_id}`}
              className={cn(
                "min-w-0 flex-1 truncate rounded-md text-sm text-ink outline-none hover:text-violet focus-visible:ring-3 focus-visible:ring-violet/40",
                done && "text-ink-muted line-through",
              )}
            >
              {task.title}
            </Link>
            {overdue && (
              <span className="shrink-0 text-xs font-medium text-pink">{t("overdue")}</span>
            )}
          </li>
        );
      })}
      {failed && <li className="pt-1 text-xs text-pink">{t("saveFailed")}</li>}
    </ul>
  );
}

/** A heading of a part of a wide widget: icon, name, count. */
function Part({
  icon: Icon,
  title,
  count,
  tone,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  count?: number;
  tone: Tone;
  children: ReactNode;
  className?: string;
}) {
  const settings = useFormatSettings();
  return (
    <section className={cn("flex min-h-0 flex-col gap-1", className)}>
      <h3 className="flex items-center gap-1.5">
        <Icon aria-hidden className={cn("size-3.5 shrink-0", toneText[tone])} />
        <span className="micro-label truncate">{title}</span>
        {count !== undefined && (
          <span className="micro-label tabular-nums">{formatNumber(count, {}, settings)}</span>
        )}
      </h3>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Today: the day's tasks, meetings, people to call back and deals that stand
// ---------------------------------------------------------------------------

type Overview = ReturnType<typeof useTodayOverview>;

function useOverviewData(): WidgetQuery<Overview> {
  const overview = useTodayOverview();
  return {
    data: overview.pending ? undefined : overview,
    isPending: overview.pending,
    isError: overview.failed && overview.pending,
    refetch: () => {
      void overview.tasks.refetch();
      void overview.events.refetch();
      void overview.followUps.refetch();
      void overview.stalled.refetch();
    },
  };
}

/** The actions of the wide Today widget, only those the person may take. */
function useTodayActions() {
  const t = useTranslations("dashboard.widgets.quickActions.actions");
  const canTask = useCan("tasks", "create");
  const canEvent = useCan("calendar", "create");
  return [
    ...(canTask ? [{ label: t("newTask"), href: QUICK_ACTIONS.newTask.href }] : []),
    ...(canEvent ? [{ label: t("newEvent"), href: QUICK_ACTIONS.newEvent.href }] : []),
  ];
}

function TodayEmpty({ compact }: { compact: boolean }) {
  const t = useTranslations("dashboard.widgets.today");
  const actions = useTodayActions();
  return (
    <Empty
      icon={SunIcon}
      tone="green"
      title={t("emptyTitle")}
      hint={t("emptyHint")}
      action={actions[0]}
      compact={compact}
    />
  );
}

/** M: the tasks as the hero, the other three counts in a row under it. */
function TodayM({ overview, tone }: { overview: Overview; tone: Tone }) {
  const t = useTranslations("dashboard.widgets.today");
  const settings = useFormatSettings();
  const { counts } = overview;
  const others = [
    { key: "events", icon: CalendarDaysIcon, count: counts.events },
    { key: "followUps", icon: PhoneCallIcon, count: counts.followUps },
    { key: "deals", icon: HandshakeIcon, count: counts.deals },
  ] as const;
  if (counts.tasks === 0 && others.every((part) => part.count === 0)) {
    return <TodayEmpty compact />;
  }
  return (
    <Stack>
      <Hero unit={t("parts.tasks", { count: counts.tasks })}>
        <LiveNumber value={counts.tasks} />
      </Hero>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {others.map(({ key, icon: Icon, count }) => (
          <li key={key} className="flex items-center gap-1.5 text-sm">
            <Icon
              aria-hidden
              className={cn("size-3.5 shrink-0", count > 0 ? toneText[tone] : "text-ink-muted")}
            />
            <span className="font-semibold text-ink tabular-nums">
              {formatNumber(count, {}, settings)}
            </span>
            <span className="truncate text-ink-soft">{t(`parts.${key}`, { count })}</span>
          </li>
        ))}
      </ul>
    </Stack>
  );
}

function EventRows({ events, limit }: { events: CalendarEvent[]; limit: number }) {
  const { timeOf } = useWhenLabel("dashboard.widgets.calendarWeek");
  return (
    <RowList>
      {events.slice(0, limit).map((event) => (
        <Row key={event.id} href="/app/kalendar" lead={timeOf(event)}>
          {event.title}
        </Row>
      ))}
    </RowList>
  );
}

/** L: the tasks to tick, then the day's events. */
function TodayL({ overview, tone }: { overview: Overview; tone: Tone }) {
  const t = useTranslations("dashboard.today");
  const { tick, failed } = useTaskTick();
  const open = overview.tasks.data?.open ?? [];
  const done = overview.tasks.data?.done ?? [];
  const events = overview.events.data ?? [];
  const taskRows = pickTaskRows(open, done, events.length > 0 ? 4 : 6);
  if (taskRows.length === 0 && events.length === 0) return <TodayEmpty compact={false} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      {taskRows.length > 0 && (
        <Part icon={CircleCheckIcon} title={t("tasks")} count={overview.counts.tasks} tone={tone}>
          <TaskRows tasks={taskRows} onTick={tick} failed={failed} />
        </Part>
      )}
      {events.length > 0 && (
        <Part icon={CalendarDaysIcon} title={t("events")} count={events.length} tone={tone}>
          <EventRows events={events} limit={taskRows.length > 0 ? 2 : 5} />
        </Part>
      )}
    </div>
  );
}

/** XL: tasks on the left, events, calls and standing deals on the right, actions below. */
function TodayXL({ overview, tone }: { overview: Overview; tone: Tone }) {
  const t = useTranslations("dashboard.today");
  const settings = useFormatSettings();
  const { tick, failed } = useTaskTick();
  const actions = useTodayActions();
  const { from } = useToday();
  const open = overview.tasks.data?.open ?? [];
  const done = overview.tasks.data?.done ?? [];
  const taskRows = pickTaskRows(open, done, 5);
  const hidden = overview.counts.tasks - taskRows.filter((task) => task.status !== "done").length;
  const events = overview.events.data ?? [];
  const followUps = overview.followUps.data ?? [];
  const stalled = overview.stalled.data?.deals ?? [];
  const now = Date.now();
  const nothing =
    taskRows.length === 0 && events.length === 0 && followUps.length === 0 && stalled.length === 0;
  if (nothing) return <TodayEmpty compact={false} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid min-h-0 flex-1 gap-x-6 gap-y-3 overflow-hidden @3xl:grid-cols-2">
        <Part icon={CircleCheckIcon} title={t("tasks")} count={overview.counts.tasks} tone={tone}>
          {taskRows.length > 0 ? (
            <TaskRows tasks={taskRows} onTick={tick} failed={failed} />
          ) : (
            <Sub>{t("emptyTitle")}</Sub>
          )}
          {hidden > 0 && (
            <Link
              href="/app/milniky"
              className="self-start text-xs font-medium text-violet outline-none hover:underline focus-visible:ring-3 focus-visible:ring-violet/40"
            >
              {t("moreTasks", { count: hidden, formatted: formatNumber(hidden, {}, settings) })}
            </Link>
          )}
        </Part>
        <div className="hidden min-h-0 flex-col gap-3 overflow-hidden @3xl:flex">
          {events.length > 0 && (
            <Part icon={CalendarDaysIcon} title={t("events")} count={events.length} tone={tone}>
              <EventRows events={events} limit={2} />
            </Part>
          )}
          {followUps.length > 0 && (
            <Part
              icon={PhoneCallIcon}
              title={t("followUps")}
              count={followUps.length}
              tone={tone}
            >
              <CallWindowNotice className="text-xs" />
              <RowList>
                {followUps.slice(0, 2).map((entry) => (
                  <Row
                    key={entry.entryId}
                    href={`/app/kontakty/${entry.contactId}`}
                    lead={formatTime(entry.dueAt, settings)}
                    trail={
                      entry.dueAt.toISOString() < from ? (
                        <span className="font-medium text-pink">{t("overdue")}</span>
                      ) : undefined
                    }
                  >
                    {entry.name || t("unnamedContact")}
                  </Row>
                ))}
              </RowList>
            </Part>
          )}
          {stalled.length > 0 && (
            <Part
              icon={HandshakeIcon}
              title={t("stalledDeals")}
              count={overview.counts.deals}
              tone={tone}
            >
              <RowList>
                {stalled.slice(0, 2).map((deal) => {
                  const days = Math.floor((now - Date.parse(deal.entered_stage_at)) / DAY_MS);
                  return (
                    <Row
                      key={deal.id}
                      href={`/app/pipeline?deal=${deal.id}`}
                      trail={
                        <span className="text-gold">
                          {t("daysInStage", {
                            count: days,
                            formatted: formatNumber(days, {}, settings),
                          })}
                        </span>
                      }
                    >
                      {deal.title}
                    </Row>
                  );
                })}
              </RowList>
            </Part>
          )}
        </div>
      </div>
      {actions.length > 0 && <Actions items={actions} />}
    </div>
  );
}

export const todayWidget = defineWidget<Overview>({
  key: "today",
  useData: useOverviewData,
  View: ({ size, data, tone }) =>
    size === "M" ? (
      <TodayM overview={data} tone={tone} />
    ) : size === "XL" ? (
      <TodayXL overview={data} tone={tone} />
    ) : (
      <TodayL overview={data} tone={tone} />
    ),
  Detail: ({ data }) => <TodayCard overview={data} bare perSection={20} />,
});

// ---------------------------------------------------------------------------
// Waiting for you: decisions only the person can make
// ---------------------------------------------------------------------------

type WaitingData = { items: ReturnType<typeof useWaitingItems>["items"] };

function useWaitingData(): WidgetQuery<WaitingData> {
  const waiting = useWaitingItems();
  return {
    data: waiting.pending ? undefined : { items: waiting.items },
    isPending: waiting.pending,
    isError: waiting.failed,
    refetch: waiting.refetch,
  };
}

function WaitingEmpty({ compact }: { compact: boolean }) {
  const t = useTranslations("dashboard.widgets.waiting");
  const settings = useFormatSettings();
  return (
    <Empty
      icon={InboxIcon}
      tone="green"
      zero={formatNumber(0, {}, settings)}
      title={t("emptyTitle")}
      hint={t("emptyHint")}
      compact={compact}
    />
  );
}

function WaitingM({ data }: { data: WaitingData }) {
  const t = useTranslations("dashboard.widgets.waiting");
  const count = data.items.length;
  if (count === 0) return <WaitingEmpty compact />;
  const first = data.items[0];
  return (
    <Stack>
      <Hero unit={t("unit", { count })}>
        <LiveNumber value={count} />
      </Hero>
      <Sub>{t(`kind.${first.kind}`, { who: first.who })}</Sub>
    </Stack>
  );
}

export const waitingWidget = defineWidget<WaitingData>({
  key: "waiting",
  useData: useWaitingData,
  View: ({ size, data }) =>
    size === "M" ? (
      <WaitingM data={data} />
    ) : (
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        <WaitingForYou variant="widget" empty={<WaitingEmpty compact={false} />} />
      </div>
    ),
  Detail: () => <WaitingForYou variant="widget" empty={<WaitingEmpty compact={false} />} />,
});

// ---------------------------------------------------------------------------
// Overdue sales tasks: open, due before now (to the minute)
// ---------------------------------------------------------------------------

type OverdueTask = Pick<CrmTask, "id" | "title" | "due_at">;
type OverdueData = { tasks: OverdueTask[] };

function useOverdueTasks(settings: WidgetSettings): WidgetQuery<OverdueData> {
  const { user } = useSession();
  const format = useFormatSettings();
  const mine = settings.scope !== "all";
  const query = useOpenTasks(
    { ...DEFAULT_FILTERS, due: "overdue", status: "open", who: mine ? user.id : "anyone" },
    format,
  );
  return combine([query], () => ({ tasks: query.data ?? [] }));
}

function overdueHref(settings: WidgetSettings) {
  return settings.scope === "all"
    ? "/app/ukoly-crm?due=overdue&status=open"
    : "/app/ukoly-crm?due=overdue&status=open&who=me";
}

/** Days a task is overdue by, in the user's calendar: 0 = due earlier today. */
function useOverdueDays() {
  const { today, timeZone } = useToday();
  return (task: OverdueTask) => Math.max(0, daysBetween(dayOf(task.due_at, timeZone), today));
}

const AGE_BUCKETS = ["today", "d1to3", "d4to7", "d8plus"] as const;

function ageBucket(days: number): (typeof AGE_BUCKETS)[number] {
  if (days === 0) return "today";
  if (days <= 3) return "d1to3";
  if (days <= 7) return "d4to7";
  return "d8plus";
}

function OverdueRows({ tasks, limit }: { tasks: OverdueTask[]; limit: number }) {
  const t = useTranslations("dashboard.widgets.overdueTasks");
  const settings = useFormatSettings();
  const daysOf = useOverdueDays();
  return (
    <RowList>
      {tasks.slice(0, limit).map((task) => {
        const days = daysOf(task);
        return (
          <Row
            key={task.id}
            href={`/app/ukoly-crm?task=${task.id}`}
            lead={
              <span className="text-pink">
                {t("ago", { count: days, formatted: formatNumber(days, {}, settings) })}
              </span>
            }
          >
            {task.title}
          </Row>
        );
      })}
    </RowList>
  );
}

function OverdueView({
  size,
  data,
  settings: widgetSettings,
  tone,
}: {
  size: string;
  data: OverdueData;
  settings: WidgetSettings;
  tone: Tone;
}) {
  const t = useTranslations("dashboard.widgets.overdueTasks");
  const settings = useFormatSettings();
  const daysOf = useOverdueDays();
  const count = data.tasks.length;
  if (count === 0) {
    return (
      <Empty
        icon={CircleCheckIcon}
        tone="green"
        zero={formatNumber(0, {}, settings)}
        title={t("count", { count: 0 })}
        hint={t("emptyHint")}
        compact={size === "S" || size === "M"}
      />
    );
  }
  const oldest = data.tasks[0];
  const oldestDays = daysOf(oldest);
  const unit = t("count", { count });

  if (size === "S") {
    return (
      <Stack>
        <Hero status="bad">
          <LiveNumber value={count} />
        </Hero>
        <Sub>{unit}</Sub>
      </Stack>
    );
  }
  if (size === "M") {
    return (
      <Stack>
        <Hero status="bad" unit={unit}>
          <LiveNumber value={count} />
        </Hero>
        <Sub>{oldest.title}</Sub>
        <Sub className="text-xs text-ink-muted">
          {t("oldestAgo", {
            count: oldestDays,
            formatted: formatNumber(oldestDays, {}, settings),
          })}
        </Sub>
      </Stack>
    );
  }
  if (size === "L") {
    return (
      <Stack>
        <Hero status="bad" size="md" unit={unit}>
          <LiveNumber value={count} />
        </Hero>
        <OverdueRows tasks={data.tasks} limit={4} />
      </Stack>
    );
  }

  const buckets = AGE_BUCKETS.map((bucket) => ({
    key: bucket,
    label: t(`bucket.${bucket}`),
    tone,
    value: data.tasks.filter((task) => ageBucket(daysOf(task)) === bucket).length,
  }));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid min-h-0 flex-1 gap-x-6 gap-y-3 overflow-hidden @3xl:grid-cols-2">
        <Stack>
          <Hero status="bad" size="md" unit={unit}>
            <LiveNumber value={count} />
          </Hero>
          <Columns
            values={buckets.map((bucket) => bucket.value)}
            labels={buckets.map((bucket) => bucket.label)}
            tone={tone}
            label={t("byAge")}
            height={48}
          />
          <Legend
            items={buckets.map((bucket) => ({
              ...bucket,
              value: formatNumber(bucket.value, {}, settings),
            }))}
          />
        </Stack>
        <div className="hidden min-h-0 flex-col @3xl:flex">
          <OverdueRows tasks={data.tasks} limit={5} />
        </div>
      </div>
      <Actions items={[{ label: t("open"), href: overdueHref(widgetSettings) }]} />
    </div>
  );
}

export const overdueTasksWidget = defineWidget<OverdueData>({
  key: "overdueTasks",
  useData: useOverdueTasks,
  View: OverdueView,
  Detail: ({ data }) => {
    const t = useTranslations("dashboard.widgets.overdueTasks");
    const settings = useFormatSettings();
    if (data.tasks.length === 0) {
      return (
        <Empty
          icon={CircleCheckIcon}
          tone="green"
          zero={formatNumber(0, {}, settings)}
          title={t("count", { count: 0 })}
          hint={t("emptyHint")}
        />
      );
    }
    return <OverdueRows tasks={data.tasks} limit={50} />;
  },
  useHref: overdueHref,
});

// ---------------------------------------------------------------------------
// Upcoming meetings and the week in the calendar
// ---------------------------------------------------------------------------

type MeetingsData = { meetings: CalendarEvent[]; days: number };

function useMeetings(settings: WidgetSettings): WidgetQuery<MeetingsData> {
  const { today, timeZone } = useToday();
  const days = Number(settings.days) || 7;
  const query = useCalendarEvents(today, addDaysIso(today, days), timeZone, true);
  return combine([query], () => {
    const now = Date.now();
    const meetings = (query.data ?? [])
      .filter(
        (event) => event.kind === "meeting" && Date.parse(event.ends_at ?? event.starts_at) >= now,
      )
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return { meetings, days };
  });
}

function MeetingsEmpty({ days, size }: { days: number; size: string }) {
  const t = useTranslations("dashboard.widgets.meetings");
  const settings = useFormatSettings();
  const formattedDays = formatNumber(days, {}, settings);
  return (
    <Empty
      icon={CalendarDaysIcon}
      tone="green"
      zero={formatNumber(0, {}, settings)}
      title={t("countIn", { count: 0, days: formattedDays })}
      hint={t("emptyHint")}
      action={{ label: t("plan"), href: QUICK_ACTIONS.newEvent.href }}
      compact={size !== "L"}
    />
  );
}

/** L: the meetings under the heading of their day. */
function MeetingsByDay({ meetings, limit }: { meetings: CalendarEvent[]; limit: number }) {
  const { timeOf, dayLabel, timeZone } = useWhenLabel("dashboard.widgets.meetings");
  const groups: { day: IsoDate; events: CalendarEvent[] }[] = [];
  for (const event of meetings.slice(0, limit)) {
    const day = dayOf(event.starts_at, timeZone);
    const group = groups[groups.length - 1];
    if (group && group.day === day) group.events.push(event);
    else groups.push({ day, events: [event] });
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      {groups.map((group) => (
        <section key={group.day} className="flex flex-col gap-0.5">
          <DetailHeading>{dayLabel(group.day)}</DetailHeading>
          <RowList>
            {group.events.map((event) => (
              <Row key={event.id} href="/app/kalendar" lead={timeOf(event)}>
                {event.title}
              </Row>
            ))}
          </RowList>
        </section>
      ))}
    </div>
  );
}

function MeetingsView({ size, data }: { size: string; data: MeetingsData }) {
  const t = useTranslations("dashboard.widgets.meetings");
  const settings = useFormatSettings();
  const { when } = useWhenLabel("dashboard.widgets.meetings");
  const count = data.meetings.length;
  if (count === 0) return <MeetingsEmpty days={data.days} size={size} />;
  const next = data.meetings[0];
  const following = data.meetings[1];

  if (size === "S") {
    return (
      <Stack>
        <Hero unit={t("count", { count })}>
          <LiveNumber value={count} />
        </Hero>
        <Sub>{t("next", { when: when(next) })}</Sub>
      </Stack>
    );
  }
  if (size === "M") {
    return (
      <Stack>
        <Hero size="md">{when(next)}</Hero>
        <Sub className="font-medium text-ink">{next.title}</Sub>
        <Sub className="text-xs text-ink-muted">
          {following
            ? t("following", { when: when(following), title: following.title })
            : t("countIn", { count, days: formatNumber(data.days, {}, settings) })}
        </Sub>
      </Stack>
    );
  }
  return <MeetingsByDay meetings={data.meetings} limit={6} />;
}

export const meetingsWidget = defineWidget<MeetingsData>({
  key: "meetings",
  useData: useMeetings,
  View: MeetingsView,
  Detail: ({ data }) =>
    data.meetings.length === 0 ? (
      <MeetingsEmpty days={data.days} size="L" />
    ) : (
      <MeetingsByDay meetings={data.meetings} limit={50} />
    ),
});

type WeekData = { days: { day: IsoDate; events: CalendarEvent[] }[]; today: IsoDate };

function useCalendarWeek(): WidgetQuery<WeekData> {
  const settings = useFormatSettings();
  const { today, timeZone } = useToday();
  const days = viewDays("week", today, settings.weekStartsOn);
  const query = useCalendarEvents(days[0], days[days.length - 1], timeZone, true);
  return combine([query], () => {
    const byDay = new Map<IsoDate, CalendarEvent[]>(days.map((day) => [day, []]));
    for (const event of query.data ?? []) {
      byDay.get(dayOf(event.starts_at, timeZone))?.push(event);
    }
    return {
      days: days.map((day) => ({
        day,
        events: (byDay.get(day) ?? []).sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
      })),
      today,
    };
  });
}

/** The actions of the wide week widget: a new event only with the right to create one. */
function useWeekActions() {
  const t = useTranslations("dashboard.widgets.calendarWeek");
  const tActions = useTranslations("dashboard.widgets.quickActions.actions");
  const canEvent = useCan("calendar", "create");
  return [
    ...(canEvent
      ? [{ label: tActions("newEvent"), href: QUICK_ACTIONS.newEvent.href, primary: true }]
      : []),
    { label: t("open"), href: "/app/kalendar" },
  ];
}

function WeekView({ size, data, tone }: { size: string; data: WeekData; tone: Tone }) {
  const t = useTranslations("dashboard.widgets.calendarWeek");
  const settings = useFormatSettings();
  const locale = useLocale();
  const { when, timeOf } = useWhenLabel("dashboard.widgets.calendarWeek");
  const actions = useWeekActions();
  const total = data.days.reduce((sum, day) => sum + day.events.length, 0);
  const todayIndex = data.days.findIndex((entry) => entry.day === data.today);
  const labels = data.days.map((entry) => formatWeekdayShort(isoDateToLocal(entry.day), locale));
  const dayNumbers = data.days.map((entry) =>
    formatNumber(isoDateToLocal(entry.day).getDate(), {}, settings),
  );
  const ahead = data.days
    .filter((entry) => entry.day >= data.today)
    .flatMap((entry) => entry.events);

  if (size === "M") {
    return (
      <Stack>
        <MiniCalendar
          tone={tone}
          label={t("density")}
          days={data.days.map((entry, index) => ({
            key: entry.day,
            weekday: labels[index],
            day: dayNumbers[index],
            count: entry.events.length,
            today: entry.day === data.today,
          }))}
        />
        <Sub>{t("thisWeek", { count: total })}</Sub>
      </Stack>
    );
  }

  if (size === "L") {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <Columns
          values={data.days.map((entry) => entry.events.length)}
          labels={labels}
          current={todayIndex}
          tone={tone}
          label={t("density")}
          height={44}
        />
        {ahead.length > 0 ? (
          <section className="flex min-h-0 flex-col gap-0.5">
            <DetailHeading>{t("upcoming")}</DetailHeading>
            <RowList>
              {ahead.slice(0, 3).map((event) => (
                <Row key={event.id} href="/app/kalendar" lead={when(event)}>
                  {event.title}
                </Row>
              ))}
            </RowList>
          </section>
        ) : (
          <Stack>
            <Sub>{t("thisWeek", { count: total })}</Sub>
            <Link
              href={actions[0].href}
              className="self-start text-sm font-medium text-violet outline-none hover:underline focus-visible:ring-3 focus-visible:ring-violet/40"
            >
              {actions[0].label}
            </Link>
          </Stack>
        )}
      </div>
    );
  }

  const perDay = 4;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ol className="grid min-h-0 flex-1 grid-cols-7 gap-1 overflow-hidden">
        {data.days.map(({ day, events }, index) => {
          const isToday = day === data.today;
          return (
            <li
              key={day}
              className={cn(
                "flex min-w-0 flex-col gap-1 rounded-lg px-1.5 py-1",
                isToday && cn(toneSoft[tone], "border"),
              )}
            >
              <div className="flex items-baseline gap-1 border-b border-line/70 pb-1">
                <span
                  className={cn(
                    "text-[10px] font-medium uppercase",
                    isToday ? toneText[tone] : "text-ink-muted",
                  )}
                >
                  {labels[index]}
                </span>
                <span className="text-sm font-semibold text-ink tabular-nums">
                  {dayNumbers[index]}
                </span>
              </div>
              {events.length > 0 && (
                <ul className="flex min-w-0 flex-col gap-0.5">
                  {events.slice(0, perDay).map((event) => (
                    <li key={event.id} className="flex min-w-0 flex-col text-[11px] leading-4">
                      <span className={cn("tabular-nums", toneText[tone])}>{timeOf(event)}</span>
                      <span className="truncate text-ink">{event.title}</span>
                    </li>
                  ))}
                  {events.length > perDay && (
                    <li className="text-[11px] text-ink-muted tabular-nums">
                      {t("more", { count: events.length - perDay })}
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      <Actions items={actions} />
    </div>
  );
}

export const calendarWeekWidget = defineWidget<WeekData>({
  key: "calendarWeek",
  useData: useCalendarWeek,
  View: WeekView,
  Detail: ({ data }) => {
    const t = useTranslations("dashboard.widgets.calendarWeek");
    const settings = useFormatSettings();
    const locale = useLocale();
    const { timeOf } = useWhenLabel("dashboard.widgets.calendarWeek");
    return (
      <div className="flex flex-col gap-4">
        {data.days.map(({ day, events }) => (
          <section key={day} className="flex flex-col gap-1">
            <DetailHeading>
              {`${formatWeekdayShort(isoDateToLocal(day), locale)} ${formatNumber(isoDateToLocal(day).getDate(), {}, settings)}`}
            </DetailHeading>
            {events.length === 0 ? (
              <p className="text-sm text-ink-muted">{t("free")}</p>
            ) : (
              <RowList>
                {events.map((event) => (
                  <Row key={event.id} href="/app/kalendar" lead={timeOf(event)}>
                    {event.title}
                  </Row>
                ))}
              </RowList>
            )}
          </section>
        ))}
      </div>
    );
  },
});

// ---------------------------------------------------------------------------
// Tasks done today (milestone tasks): the ring, and the open ones to tick
// ---------------------------------------------------------------------------

type DoneData = { done: DashTask[]; open: DashTask[]; openTotal: number };

function useTasksDone(): WidgetQuery<DoneData> {
  const tasks = useTodayTasks();
  return combine([tasks], () => ({
    done: tasks.data!.done,
    open: tasks.data!.open,
    openTotal: tasks.data!.openTotal,
  }));
}

function DoneRing({ data, tone, size }: { data: DoneData; tone: Tone; size: number }) {
  const t = useTranslations("dashboard.tiles.tasks");
  const settings = useFormatSettings();
  const done = data.done.length;
  const total = done + data.openTotal;
  const rate = taskCompletionRate(done, total);
  return (
    <Ring
      value={done}
      max={total}
      tone={tone}
      size={size}
      label={t("ring", {
        done: formatNumber(done, {}, settings),
        total: formatNumber(total, {}, settings),
      })}
    >
      <span className="flex flex-col items-center gap-0.5 leading-none">
        {rate === null ? (
          <>
            <span aria-hidden className="text-xl font-bold text-ink-muted">
              –
            </span>
            <span className="text-[10px] font-medium tracking-wide text-ink-muted uppercase">
              {t("todayNone")}
            </span>
          </>
        ) : (
          <span className={cn("font-bold text-ink", size >= 80 ? "text-lg" : "text-base")}>
            <LiveNumber value={rate} format={{ style: "percent" }} />
          </span>
        )}
      </span>
    </Ring>
  );
}

function DoneView({ size, data, tone }: { size: string; data: DoneData; tone: Tone }) {
  const t = useTranslations("dashboard.tiles.tasks");
  const tWidget = useTranslations("dashboard.widgets.tasksDone");
  const settings = useFormatSettings();
  const { tick, failed } = useTaskTick();
  const done = data.done.length;
  const total = done + data.openTotal;
  const left = total - done;
  const sentence =
    total === 0
      ? t("none")
      : left === 0
        ? t("allDone")
        : t("left", { count: left, formatted: formatNumber(left, {}, settings) });

  if (size === "S") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <DoneRing data={data} tone={tone} size={72} />
      </div>
    );
  }
  const side = (
    <Side aside={<DoneRing data={data} tone={tone} size={size === "M" ? 64 : 84} />}>
      <Hero size="md" unit={tWidget("of", { total: formatNumber(total, {}, settings) })}>
        <LiveNumber value={done} />
      </Hero>
      <Sub lines={size === "M" ? 1 : 2}>{sentence}</Sub>
    </Side>
  );
  if (size === "M") return side;
  const rows = pickTaskRows(data.open, data.done, 4);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="shrink-0">{side}</div>
      {rows.length > 0 && <TaskRows tasks={rows} onTick={tick} failed={failed} />}
    </div>
  );
}

export const tasksDoneWidget = defineWidget<DoneData>({
  key: "tasksDone",
  useData: useTasksDone,
  View: DoneView,
  Detail: () => <TasksDetail />,
});
