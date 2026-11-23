"use client";

import { useEffect, useState } from "react";
import {
  CalendarDaysIcon,
  CalendarRangeIcon,
  CircleCheckIcon,
  HandshakeIcon,
  InboxIcon,
  PhoneCallIcon,
  SunIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { ProgressRing } from "@/components/ui/progress-ring";
import { useSession } from "@/features/account/queries";
import { addDaysIso, viewDays } from "@/features/calendar/calendar-logic";
import { useCalendarEvents } from "@/features/calendar/queries";
import type { CalendarEvent } from "@/features/calendar/types";
import { DEFAULT_FILTERS } from "@/features/crm-tasks/logic";
import { useOpenTasks } from "@/features/crm-tasks/queries";
import { WaitingForYou } from "@/features/dashboard/waiting-for-you";
import { TodayCard, useTodayOverview } from "@/features/dashboard/today-card";
import { useToday, useTodayTasks } from "@/features/dashboard/queries";
import { taskCompletionRate } from "@/features/dashboard/dashboard-logic";
import { TasksDetail } from "@/features/dashboard/tile-detail";
import {
  formatDateTime,
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
import {
  BigValue,
  combine,
  defineWidget,
  DetailHeading,
  Empty,
  Hint,
  READY,
  Row,
  RowList,
  type WidgetQuery,
  type WidgetSettings,
} from "../kit";

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

function TodayCounts({ overview }: { overview: Overview }) {
  const t = useTranslations("dashboard.widgets.today");
  const settings = useFormatSettings();
  const { counts } = overview;
  const parts = [
    { key: "tasks", icon: CircleCheckIcon, count: counts.tasks },
    { key: "events", icon: CalendarDaysIcon, count: counts.events },
    { key: "followUps", icon: PhoneCallIcon, count: counts.followUps },
    { key: "deals", icon: HandshakeIcon, count: counts.deals },
  ] as const;
  if (parts.every((part) => part.count === 0)) {
    return (
      <Empty icon={SunIcon} tone="green" title={t("emptyTitle")} hint={t("emptyHint")} compact />
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 @md:grid-cols-4">
      {parts.map(({ key, icon: Icon, count }) => (
        <li key={key} className="flex items-center gap-2 text-sm">
          <Icon aria-hidden className="size-4 shrink-0 text-ink-muted" />
          <span className="font-semibold text-ink tabular-nums">
            {formatNumber(count, {}, settings)}
          </span>
          <span className="truncate text-ink-soft">{t(`parts.${key}`, { count })}</span>
        </li>
      ))}
    </ul>
  );
}

export const todayWidget = defineWidget<Overview>({
  key: "today",
  useData: useOverviewData,
  View: ({ size, data }) =>
    size === "M" ? (
      <TodayCounts overview={data} />
    ) : (
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        <TodayCard overview={data} bare perSection={size === "XL" ? 4 : 3} />
      </div>
    ),
  Detail: ({ data }) => <TodayCard overview={data} bare perSection={20} />,
});

// ---------------------------------------------------------------------------
// Waiting for you: decisions only the person can make
// ---------------------------------------------------------------------------

function WaitingEmpty() {
  const t = useTranslations("dashboard.widgets.waiting");
  return <Empty icon={InboxIcon} tone="green" title={t("emptyTitle")} hint={t("emptyHint")} />;
}

export const waitingWidget = defineWidget<true>({
  key: "waiting",
  useData: () => READY,
  View: () => (
    <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
      <WaitingForYou variant="widget" empty={<WaitingEmpty />} />
    </div>
  ),
  Detail: () => <WaitingForYou variant="widget" empty={<WaitingEmpty />} />,
});

// ---------------------------------------------------------------------------
// Overdue sales tasks: open, due before now (to the minute)
// ---------------------------------------------------------------------------

type OverdueData = { tasks: { id: string; title: string; due_at: string }[] };

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

function OverdueView({ size, data }: { size: string; data: OverdueData }) {
  const t = useTranslations("dashboard.widgets.overdueTasks");
  const settings = useFormatSettings();
  const count = data.tasks.length;
  if (count === 0) {
    return (
      <Empty
        icon={CircleCheckIcon}
        tone="green"
        title={t("emptyTitle")}
        hint={size === "S" ? undefined : t("emptyHint")}
        compact={size !== "L" && size !== "XL"}
      />
    );
  }
  const shown = size === "XL" ? 6 : size === "L" ? 5 : 0;
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <BigValue className="text-pink">
        <AnimatedNumber value={count} />
      </BigValue>
      {size === "S" ? (
        <Hint>{t("count", { count })}</Hint>
      ) : size === "M" ? (
        <Hint>{t("first", { title: data.tasks[0].title })}</Hint>
      ) : (
        <RowList>
          {data.tasks.slice(0, shown).map((task) => (
            <Row
              key={task.id}
              href={`/app/ukoly-crm?task=${task.id}`}
              trail={
                <span className="text-pink">{formatDateTime(new Date(task.due_at), settings)}</span>
              }
            >
              {task.title}
            </Row>
          ))}
        </RowList>
      )}
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
        <Empty icon={CircleCheckIcon} tone="green" title={t("emptyTitle")} hint={t("emptyHint")} />
      );
    }
    return (
      <RowList>
        {data.tasks.slice(0, 50).map((task) => (
          <Row
            key={task.id}
            href={`/app/ukoly-crm?task=${task.id}`}
            trail={
              <span className="text-pink">{formatDateTime(new Date(task.due_at), settings)}</span>
            }
          >
            {task.title}
          </Row>
        ))}
      </RowList>
    );
  },
  useHref: (settings) =>
    settings.scope === "all"
      ? "/app/ukoly-crm?due=overdue&status=open"
      : "/app/ukoly-crm?due=overdue&status=open&who=me",
});

// ---------------------------------------------------------------------------
// Upcoming meetings and the week in the calendar
// ---------------------------------------------------------------------------

function dayOf(instant: string, timeZone: string): IsoDate {
  return localToIsoDate(toZonedWallClock(new Date(instant), timeZone));
}

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

function MeetingWhen({ event }: { event: CalendarEvent }) {
  const settings = useFormatSettings();
  const locale = useLocale();
  const t = useTranslations("dashboard.widgets.meetings");
  const { today, timeZone } = useToday();
  const day = dayOf(event.starts_at, timeZone);
  const time = event.all_day ? t("allDay") : formatTime(new Date(event.starts_at), settings);
  if (day === today) return <>{t("todayAt", { time })}</>;
  if (day === addDaysIso(today, 1)) return <>{t("tomorrowAt", { time })}</>;
  return <>{`${formatWeekdayShort(isoDateToLocal(day), locale)} ${time}`}</>;
}

function MeetingsView({ size, data }: { size: string; data: MeetingsData }) {
  const t = useTranslations("dashboard.widgets.meetings");
  const settings = useFormatSettings();
  if (data.meetings.length === 0) {
    return (
      <Empty
        icon={CalendarDaysIcon}
        tone="violet"
        title={t("emptyTitle", { days: formatNumber(data.days, {}, settings) })}
        hint={size === "S" ? undefined : t("emptyHint")}
        action={size === "S" ? undefined : { label: t("plan"), href: "/app/kalendar?new=event" }}
        compact={size !== "L"}
      />
    );
  }
  const next = data.meetings[0];
  if (size === "S") {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-lg font-semibold text-ink tabular-nums">
          <MeetingWhen event={next} />
        </span>
        <Hint>{next.title}</Hint>
      </div>
    );
  }
  return (
    <RowList>
      {data.meetings.slice(0, size === "L" ? 6 : 2).map((event) => (
        <Row key={event.id} href="/app/kalendar" lead={<MeetingWhen event={event} />}>
          {event.title}
        </Row>
      ))}
    </RowList>
  );
}

export const meetingsWidget = defineWidget<MeetingsData>({
  key: "meetings",
  useData: useMeetings,
  View: MeetingsView,
  Detail: ({ data }) => {
    const t = useTranslations("dashboard.widgets.meetings");
    const settings = useFormatSettings();
    if (data.meetings.length === 0) {
      return (
        <Empty
          icon={CalendarDaysIcon}
          tone="violet"
          title={t("emptyTitle", { days: formatNumber(data.days, {}, settings) })}
          hint={t("emptyHint")}
          action={{ label: t("plan"), href: "/app/kalendar?new=event" }}
        />
      );
    }
    return (
      <RowList>
        {data.meetings.map((event) => (
          <Row key={event.id} href="/app/kalendar" lead={<MeetingWhen event={event} />}>
            {event.title}
          </Row>
        ))}
      </RowList>
    );
  },
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

function WeekView({ size, data }: { size: string; data: WeekData }) {
  const t = useTranslations("dashboard.widgets.calendarWeek");
  const settings = useFormatSettings();
  const locale = useLocale();
  const total = data.days.reduce((sum, day) => sum + day.events.length, 0);
  if (total === 0 && size === "M") {
    return <Empty icon={CalendarRangeIcon} title={t("emptyTitle")} hint={t("emptyHint")} compact />;
  }
  const perDay = size === "XL" ? 3 : size === "L" ? 2 : 0;
  return (
    <ol className={cn("grid min-h-0 flex-1 grid-cols-7 gap-1.5", size === "L" && "@lg:gap-2")}>
      {data.days.map(({ day, events }) => {
        const isToday = day === data.today;
        return (
          <li
            key={day}
            className={cn(
              "flex min-w-0 flex-col gap-1 rounded-lg border p-1.5",
              isToday ? "border-teal/50 bg-teal/8" : "border-line",
            )}
          >
            <span
              className={cn(
                "text-[11px] font-medium uppercase",
                isToday ? "text-teal" : "text-ink-muted",
              )}
            >
              {formatWeekdayShort(isoDateToLocal(day), locale)}
            </span>
            <span className="text-sm font-semibold text-ink tabular-nums">
              {formatNumber(isoDateToLocal(day).getDate(), {}, settings)}
            </span>
            {perDay === 0 ? (
              events.length > 0 && (
                <span
                  className="text-xs text-violet tabular-nums"
                  aria-label={t("events", { count: events.length })}
                >
                  {"•".repeat(Math.min(events.length, 3))}
                </span>
              )
            ) : (
              <ul className="flex min-w-0 flex-col gap-0.5">
                {events.slice(0, perDay).map((event) => (
                  <li
                    key={event.id}
                    className="truncate rounded bg-violet/15 px-1 text-[11px] text-ink"
                  >
                    {event.title}
                  </li>
                ))}
                {events.length > perDay && (
                  <li className="text-[11px] text-ink-muted">
                    {t("more", { count: events.length - perDay })}
                  </li>
                )}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
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
                  <Row
                    key={event.id}
                    href="/app/kalendar"
                    lead={
                      event.all_day ? t("allDay") : formatTime(new Date(event.starts_at), settings)
                    }
                  >
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
// Tasks done today (milestone tasks): the ring of the former tile
// ---------------------------------------------------------------------------

type DoneData = {
  done: number;
  total: number;
  open: { id: string; title: string; milestone_id: string }[];
};

function useTasksDone(): WidgetQuery<DoneData> {
  const tasks = useTodayTasks();
  return combine([tasks], () => ({
    done: tasks.data!.done.length,
    total: tasks.data!.done.length + tasks.data!.openTotal,
    open: tasks.data!.open,
  }));
}

/** False on the first paint, true a frame later, so the ring grows from empty. */
function useAppeared() {
  const [appeared, setAppeared] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setAppeared(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return appeared;
}

function DoneView({ size, data }: { size: string; data: DoneData }) {
  const t = useTranslations("dashboard.tiles.tasks");
  const settings = useFormatSettings();
  const appeared = useAppeared();
  const rate = taskCompletionRate(data.done, data.total);
  const ring = (
    <ProgressRing
      value={appeared ? data.done : 0}
      max={Math.max(data.total, 1)}
      label={t("ring", {
        done: formatNumber(data.done, {}, settings),
        total: formatNumber(data.total, {}, settings),
      })}
      size={size === "S" ? 72 : 84}
      tone="teal"
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
          <span className="text-lg font-bold text-ink tabular-nums">
            <AnimatedNumber value={rate} format={{ style: "percent" }} />
          </span>
        )}
      </span>
    </ProgressRing>
  );
  const sentence =
    data.total === 0
      ? t("none")
      : data.done === data.total
        ? t("allDone")
        : t("left", {
            count: data.total - data.done,
            formatted: formatNumber(data.total - data.done, {}, settings),
          });
  if (size === "S") return <div className="flex flex-1 items-center justify-center">{ring}</div>;
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center gap-4">
        {ring}
        <p className="min-w-0 text-sm text-ink-soft">{sentence}</p>
      </div>
      {size === "L" && data.open.length > 0 && (
        <RowList>
          {data.open.slice(0, 3).map((task) => (
            <Row key={task.id} href={`/app/milniky/${task.milestone_id}`}>
              {task.title}
            </Row>
          ))}
        </RowList>
      )}
    </div>
  );
}

export const tasksDoneWidget = defineWidget<DoneData>({
  key: "tasksDone",
  useData: useTasksDone,
  View: DoneView,
  Detail: () => <TasksDetail />,
});
