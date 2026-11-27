"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  HandshakeIcon,
  CalendarRangeIcon,
  LayersIcon,
  ListChecksIcon,
  PlusIcon,
  SquareCheckBigIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { PageHeader } from "@/components/ui/page-header";
import { MarkSeenOnVisit } from "@/features/game/mark-seen-on-visit";
import {
  formatCalendarDate,
  formatMonthYear,
  isoDateToLocal,
  todayIsoDate,
  weekdayName,
  type IsoDate,
} from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useIsPhone } from "@/lib/use-media-query";
import { useUrlIntent } from "@/lib/use-url-intent";
import { cn } from "@/lib/utils";
import {
  addDaysIso,
  isSameMonth,
  itemsByDay,
  shiftCursor,
  toEventItem,
  toMirrorItem,
  toBusyItems,
  toTaskItem,
  viewDays,
  type TimeRange,
  canEditEvent,
} from "./calendar-logic";
import { canEditTask } from "@/features/crm-tasks/access";
import { dealHref } from "@/features/crm-tasks/types";
import { useCalendarTasks, useMoveTask } from "@/features/crm-tasks/queries";
import { useTaskDialogs } from "@/features/crm-tasks/use-task-dialogs";
import { EventDetail } from "./event-detail";
import { EventFormDialog, type NewEventStart } from "./event-form-dialog";
import { MonthView } from "./month-view";
import { useCan, useWorkspace } from "@/features/account/workspace-queries";
import { calendarKeys, useCalendarEvents, useMirrors, useUpdateEvent } from "./queries";
import { useSyncOnOpen } from "./sync/queries";
import { useSubscriptionBusy } from "@/features/scheduler/queries";
import { TimeGrid } from "./time-grid";
import {
  CALENDAR_VIEWS,
  type CalendarEvent,
  type CalendarItem,
  type CalendarView,
  type MirrorPrefs,
  type TimedItem,
} from "./types";
import {
  DEFAULT_MIRRORS,
  loadMirrors,
  loadSourcePrefs,
  loadView,
  saveMirrors,
  saveSourcePrefs,
  saveView,
  type SourcePrefs,
} from "./view-preference";
import { calendarOwnerOf, GRADUS_SOURCE, editPath } from "./sharing/levels";
import { ownEventLook, personLooks, sharedItems, sharedToEvent } from "./sharing/items";
import {
  useCalendarPeople,
  useMySources,
  usePersonPrefs,
  useSaveSharedEvent,
  useSharedEvents,
} from "./sharing/queries";
import { CalendarsPanel } from "./sharing/ui/calendars-panel";
import { RequestShareDialog } from "./sharing/ui/request-share-dialog";
import { AnswerRequestDialog } from "./sharing/ui/answer-request-dialog";
import { CommonTimeDialog } from "./sharing/ui/common-time-dialog";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { WeekList } from "./week-list";

/** Pixels per hour: taller on a phone so half an hour is still a 44 px target. */
const HOUR_PX_PHONE = 88;
const HOUR_PX = 60;

/** The clock, refreshed so the current-time line and today's marker stay right. */
function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [intervalMs]);
  return now;
}

export function CalendarView() {
  const t = useTranslations("calendar");
  const tNav = useTranslations("nav");
  const locale = useLocale();
  const router = useRouter();
  const settings = useFormatSettings();
  const isPhone = useIsPhone();
  const now = useNow(30_000);
  const today = todayIsoDate(settings, now);
  const update = useUpdateEvent();
  const moveTask = useMoveTask();
  const workspace = useWorkspace();
  const taskDialogs = useTaskDialogs(now);
  // New events need "create"; changing one "update" (others' only with "all events").
  // What may not happen is hidden; RLS refuses it anyway.
  const canCreate = useCan("calendar", "create");
  const canUpdate = useCan("calendar", "update");
  const canSeeAll = useCan("calendar", "view_all");
  const eventEditable = (event: CalendarEvent) =>
    canEditEvent(event, {
      owner: workspace.role === "owner",
      update: canUpdate,
      viewAll: canSeeAll,
      userId: workspace.userId,
    });

  const [view, setView] = useState<CalendarView>("month");
  const [mirrors, setMirrors] = useState<MirrorPrefs>(DEFAULT_MIRRORS);
  // The remembered choices live in the browser; wait for them so the wrong view is never fetched.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setView(loadView());
    setMirrors(loadMirrors());
    setReady(true);
  }, []);

  const [cursor, setCursor] = useState<IsoDate>(() => todayIsoDate(settings));
  const [form, setForm] = useState<{
    event: CalendarEvent | null;
    start: NewEventStart | null;
  } | null>(null);
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [changeFailed, setChangeFailed] = useState(false);
  // Calendar sharing (30.3).
  const [sourcePrefs, setSourcePrefs] = useState<SourcePrefs>({});
  const [panelOpen, setPanelOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [commonOpen, setCommonOpen] = useState(false);
  const [answerId, setAnswerId] = useState<string | null>(null);
  useEffect(() => setSourcePrefs(loadSourcePrefs()), []);
  // The bell, the dashboard and Grady open a request waiting for an answer.
  useUrlIntent("shareRequest", (id) => setAnswerId(id));

  // The search opens a found event on its day, or a new event.
  useUrlIntent(
    "event",
    (id, params) => {
      const date = params.get("date");
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) setCursor(date);
      setOpenEventId(id);
    },
    ["date"],
  );
  useUrlIntent("new", (value) => {
    if (value === "event" && canCreate) setForm({ event: null, start: null });
  });

  const days = useMemo(
    () => viewDays(view, cursor, settings.weekStartsOn),
    [view, cursor, settings.weekStartsOn],
  );
  const firstDay = days[0];
  const lastDay = days[days.length - 1];

  const eventsQuery = useCalendarEvents(firstDay, lastDay, settings.timeZone, ready);
  // Google and Apple calendars are read when the calendar opens (28.10).
  const queryClient = useQueryClient();
  useSyncOnOpen(
    () => void queryClient.invalidateQueries({ queryKey: calendarKeys.all(workspace.userId) }),
  );
  const mirrorsQuery = useMirrors(firstDay, lastDay, mirrors, ready);
  const tasksQuery = useCalendarTasks(
    firstDay,
    lastDay,
    settings.timeZone,
    ready && mirrors.crmTasks,
  );

  // Busy times of the account's subscribed calendars (Settings → Calendar), grey and read only.
  const busyQuery = useSubscriptionBusy(ready);
  const hasSubscriptions = (busyQuery.data ?? []).length > 0;

  // Others' calendars the account sees here, and its own sources.
  const peopleQuery = useCalendarPeople(ready);
  const prefsQuery = usePersonPrefs();
  const sourcesQuery = useMySources(ready);
  const sharedQuery = useSharedEvents(firstDay, lastDay, settings.timeZone, ready);
  const saveShared = useSaveSharedEvent();
  const people = useMemo(() => peopleQuery.data ?? [], [peopleQuery.data]);
  const looks = useMemo(() => personLooks(people, prefsQuery.data), [people, prefsQuery.data]);
  const writable = useMemo(
    () =>
      people
        .filter((person) => person.canWrite)
        .map((person) => ({ userId: person.userId, name: person.name, writesTo: person.writesTo })),
    [people],
  );
  const busyLabel = t("sharing.busy");

  const items = useMemo(() => {
    const own = eventsQuery.data ?? [];
    const ownIds = new Set(own.map((event) => event.id));
    const ownItems = own.flatMap((event) => {
      const item = toEventItem(event, settings.timeZone);
      const owner = calendarOwnerOf(event);
      if (owner && owner !== workspace.userId) {
        // Someone else's calendar the account reads anyway: their colour and checkbox.
        const looked = ownEventLook(item, workspace.userId, looks);
        return looked ? [looked] : [];
      }
      // The account's own sources: Gradus, each Google / Apple calendar.
      const pref = sourcePrefs[event.link?.calendar_id ?? GRADUS_SOURCE];
      if (pref?.hidden) return [];
      return [pref?.tone ? { ...item, tone: pref.tone } : item];
    });
    const list: CalendarItem[] = [
      ...ownItems,
      ...sharedItems(sharedQuery.data ?? [], looks, ownIds, settings.timeZone, busyLabel),
      ...(mirrorsQuery.data ?? []).map(toMirrorItem),
      ...(mirrors.crmTasks ? (tasksQuery.data ?? []) : []).map((task) =>
        toTaskItem(task, settings.timeZone, now),
      ),
      ...(mirrors.subscriptions
        ? toBusyItems(busyQuery.data ?? [], settings.timeZone, firstDay, lastDay)
        : []),
    ];
    return itemsByDay(list, days);
  }, [
    eventsQuery.data,
    sharedQuery.data,
    looks,
    sourcePrefs,
    busyLabel,
    workspace.userId,
    mirrorsQuery.data,
    tasksQuery.data,
    busyQuery.data,
    mirrors.crmTasks,
    mirrors.subscriptions,
    days,
    firstDay,
    lastDay,
    settings.timeZone,
    now,
  ]);

  const sharedOpen = (sharedQuery.data ?? []).find(
    (event) => event.id === openEventId && !event.busyOnly,
  );
  const openEvent =
    (eventsQuery.data ?? []).find((event) => event.id === openEventId) ??
    (sharedOpen ? sharedToEvent(sharedOpen) : null);

  function changeOwnSource(key: string, pref: SourcePrefs[string]) {
    const next = { ...sourcePrefs, [key]: pref };
    setSourcePrefs(next);
    saveSourcePrefs(next);
  }

  function chooseView(next: CalendarView) {
    setView(next);
    saveView(next);
  }

  function toggleMirror(key: keyof MirrorPrefs) {
    const next = { ...mirrors, [key]: !mirrors[key] };
    setMirrors(next);
    saveMirrors(next);
  }

  function pickDay(day: IsoDate) {
    setCursor(day);
    setView("day");
  }

  function openItem(item: CalendarItem) {
    // A subscribed calendar's busy time is only shown; it opens nothing.
    if (item.type === "busy") return;
    if (item.type === "mirror") router.push(item.mirror.href);
    else if (item.type === "task") taskDialogs.open(item.task);
    // A deal's delivery date belongs to the deal: it opens the deal, never an editor.
    else if (item.event.source === "deal_deadline" && item.event.deal_id) {
      router.push(dealHref(item.event.deal_id));
    } else setOpenEventId(item.event.id);
  }

  /** A dragged event gets its new range; a dragged task only a new due moment. */
  function changeItem(item: TimedItem, range: TimeRange) {
    setChangeFailed(false);
    if (item.type === "task") {
      if (!canEditTask(workspace, item.task)) return;
      moveTask.mutate(
        { id: item.task.id, dueAt: range.starts_at },
        { onError: () => setChangeFailed(true) },
      );
      return;
    }
    const path = editPath({
      tableEditable: !item.event.shared && eventEditable(item.event),
      sharedEditable: Boolean(item.event.shared?.canEdit),
    });
    if (path === "table") {
      update.mutate({ id: item.event.id, patch: range }, { onError: () => setChangeFailed(true) });
    } else if (path === "share" && item.event.shared) {
      const event = item.event;
      saveShared.mutate(
        {
          owner: event.shared!.personId,
          eventId: event.id,
          title: event.title,
          kind: event.kind === "task" ? "task" : event.kind === "deadline" ? "deadline" : "meeting",
          startsAt: range.starts_at,
          endsAt: range.ends_at,
          allDay: false,
          description: event.description ?? "",
          private: Boolean(event.private),
        },
        { onError: () => setChangeFailed(true) },
      );
    }
  }

  /** New events start on today when it is on screen, else on the shown day. */
  function defaultDay(): IsoDate {
    if (view === "month") return isSameMonth(today, cursor) ? today : cursor;
    return days.includes(today) ? today : cursor;
  }

  const date = isoDateToLocal(cursor);
  const title =
    view === "month"
      ? formatMonthYear(date, locale)
      : view === "week"
        ? `${formatCalendarDate(firstDay, settings)} – ${formatCalendarDate(lastDay, settings)}`
        : `${weekdayName(date.getDay(), locale)} ${formatCalendarDate(cursor, settings)}`;

  const failed =
    eventsQuery.isError || mirrorsQuery.isError || tasksQuery.isError || sharedQuery.isError;
  // A new event: in one's own calendar (calendar: create) or in someone's with write.
  const canAdd = canCreate || writable.length > 0;
  const panel = (
    <CalendarsPanel
      sources={sourcesQuery.data ?? []}
      ownPrefs={sourcePrefs}
      onOwnChange={changeOwnSource}
      people={people}
      looks={looks}
      onRequest={() => {
        setPanelOpen(false);
        setRequestOpen(true);
      }}
      onCommonTime={() => {
        setPanelOpen(false);
        setCommonOpen(true);
      }}
      canPlanMeetings={canCreate}
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <MarkSeenOnVisit section="calendar" />
      <PageHeader
        title={tNav("calendar")}
        description={t("description")}
        actions={
          canAdd && (
            <Button onClick={() => setForm({ event: null, start: { day: defaultDay() } })}>
              <PlusIcon aria-hidden data-icon="inline-start" />
              {t("actions.add")}
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label={t(`nav.previous.${view}`)}
            onClick={() => setCursor(shiftCursor(view, cursor, -1))}
          >
            <ChevronLeftIcon aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={t(`nav.next.${view}`)}
            onClick={() => setCursor(shiftCursor(view, cursor, 1))}
          >
            <ChevronRightIcon aria-hidden />
          </Button>
          <Button variant="outline" onClick={() => setCursor(today)}>
            {t("nav.today")}
          </Button>
        </div>
        <h2
          aria-live="polite"
          className="min-w-0 flex-1 text-lg font-semibold text-balance text-ink"
        >
          {title}
        </h2>
        <div
          role="group"
          aria-label={t("views.label")}
          className="flex rounded-xl border border-line bg-surface p-1"
        >
          {CALENDAR_VIEWS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => chooseView(option)}
              className={cn(
                "h-11 min-w-16 cursor-pointer rounded-lg px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 mouse:h-9",
                view === option ? "bg-violet text-on-violet" : "text-ink-soft hover:text-ink",
              )}
            >
              {t(`views.${option}`)}
            </button>
          ))}
        </div>
      </div>

      <div role="group" aria-label={t("mirrors.label")} className="flex flex-wrap gap-2">
        <MirrorToggle
          pressed={mirrors.tasks}
          tone="teal"
          onToggle={() => toggleMirror("tasks")}
          icon={<ListChecksIcon aria-hidden className="size-4" />}
        >
          {t("mirrors.tasks")}
        </MirrorToggle>
        <MirrorToggle
          pressed={mirrors.deals}
          tone="gold"
          onToggle={() => toggleMirror("deals")}
          icon={<HandshakeIcon aria-hidden className="size-4" />}
        >
          {t("mirrors.deals")}
        </MirrorToggle>
        <MirrorToggle
          pressed={mirrors.crmTasks}
          tone="violet"
          onToggle={() => toggleMirror("crmTasks")}
          icon={<SquareCheckBigIcon aria-hidden className="size-4" />}
        >
          {t("mirrors.crmTasks")}
        </MirrorToggle>
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border border-line px-4 text-sm font-medium text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 mouse:h-9 lg:hidden"
          data-testid="calendars-panel-open"
        >
          <LayersIcon aria-hidden className="size-4" />
          {t("sharing.panel.title")}
          {people.length > 0 && (
            <span className="text-xs text-ink-muted tabular-nums">{people.length}</span>
          )}
        </button>
        {hasSubscriptions && (
          <MirrorToggle
            pressed={mirrors.subscriptions}
            tone="neutral"
            onToggle={() => toggleMirror("subscriptions")}
            icon={<CalendarRangeIcon aria-hidden className="size-4" />}
          >
            {t("mirrors.subscriptions")}
          </MirrorToggle>
        )}
      </div>

      {(failed || changeFailed) && (
        <FormAlert>{changeFailed ? t("notices.changeFailed") : t("notices.loadFailed")}</FormAlert>
      )}

      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          {view === "month" && (
            <MonthView
              days={days}
              cursor={cursor}
              today={today}
              isPhone={isPhone}
              items={items}
              onPickDay={pickDay}
              onOpenItem={openItem}
              onSwipe={(direction) => setCursor(shiftCursor("month", cursor, direction))}
            />
          )}
          {view === "week" && isPhone && (
            <WeekList
              days={days}
              today={today}
              items={items}
              onPickDay={pickDay}
              onOpenItem={openItem}
              onSwipe={(direction) => setCursor(addDaysIso(cursor, direction * 7))}
            />
          )}
          {((view === "week" && !isPhone) || view === "day") && (
            <TimeGrid
              days={days}
              today={today}
              now={now}
              hourPx={isPhone ? HOUR_PX_PHONE : HOUR_PX}
              items={items}
              onPickDay={view === "week" ? pickDay : undefined}
              onOpenItem={openItem}
              onCreate={(day, range) => canAdd && setForm({ event: null, start: { day, range } })}
              onChangeEvent={changeItem}
            />
          )}
        </div>
        <aside
          aria-label={t("sharing.panel.title")}
          className="hidden rounded-2xl border border-line bg-surface/60 p-4 lg:sticky lg:top-24 lg:block"
        >
          <h2 className="mb-3 text-sm font-semibold text-ink">{t("sharing.panel.title")}</h2>
          {panel}
        </aside>
      </div>
      <ResponsiveDialog
        open={panelOpen}
        onOpenChange={setPanelOpen}
        title={t("sharing.panel.title")}
        closeLabel={t("detail.close")}
      >
        {panel}
      </ResponsiveDialog>
      <RequestShareDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        personId={null}
        from="calendar"
      />
      <CommonTimeDialog open={commonOpen} onOpenChange={setCommonOpen} />
      <AnswerRequestDialog requestId={answerId} onClose={() => setAnswerId(null)} />
      {taskDialogs.dialogs}

      <EventDetail
        event={openEvent}
        onClose={() => setOpenEventId(null)}
        readOnly={
          !openEvent || (openEvent.shared ? !openEvent.shared.canEdit : !eventEditable(openEvent))
        }
        onEdit={(event) => {
          setOpenEventId(null);
          setForm({ event, start: null });
        }}
      />
      <EventFormDialog
        open={form !== null}
        onOpenChange={(open) => !open && setForm(null)}
        event={form?.event ?? null}
        start={form?.start ?? null}
        writable={writable}
        canCreateOwn={canCreate}
      />
    </div>
  );
}

const TOGGLE_TONE = {
  teal: "border-teal/60 bg-teal/10 text-teal",
  gold: "border-gold/60 bg-gold/10 text-gold",
  violet: "border-violet/60 bg-violet/10 text-violet",
  neutral: "border-line-strong bg-surface-hover text-ink-soft",
} as const;

function MirrorToggle({
  pressed,
  tone,
  onToggle,
  icon,
  children,
}: {
  pressed: boolean;
  tone: "teal" | "gold" | "violet" | "neutral";
  onToggle: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={cn(
        "inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border border-dashed px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 mouse:h-9",
        pressed ? TOGGLE_TONE[tone] : "border-line text-ink-muted hover:text-ink",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
