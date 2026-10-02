"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  HandshakeIcon,
  ListChecksIcon,
  PlusIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { PageHeader } from "@/components/ui/page-header";
import { MarkSeenOnVisit } from "@/features/gamification/mark-seen-on-visit";
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
  viewDays,
  type TimeRange,
} from "./calendar-logic";
import { EventDetail } from "./event-detail";
import { EventFormDialog, type NewEventStart } from "./event-form-dialog";
import { MonthView } from "./month-view";
import { useCan } from "@/features/account/workspace-queries";
import { useCalendarEvents, useMirrors, useUpdateEvent } from "./queries";
import { TimeGrid } from "./time-grid";
import {
  CALENDAR_VIEWS,
  type CalendarEvent,
  type CalendarItem,
  type CalendarView,
  type EventItem,
  type MirrorPrefs,
} from "./types";
import { DEFAULT_MIRRORS, loadMirrors, loadView, saveMirrors, saveView } from "./view-preference";
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
  // Without the right to edit, the calendar is to look at; RLS refuses changes anyway.
  const canEdit = useCan("calendar", "edit");

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
    if (value === "event" && canEdit) setForm({ event: null, start: null });
  });

  const days = useMemo(
    () => viewDays(view, cursor, settings.weekStartsOn),
    [view, cursor, settings.weekStartsOn],
  );
  const firstDay = days[0];
  const lastDay = days[days.length - 1];

  const eventsQuery = useCalendarEvents(firstDay, lastDay, settings.timeZone, ready);
  const mirrorsQuery = useMirrors(firstDay, lastDay, mirrors, ready);

  const items = useMemo(() => {
    const list: CalendarItem[] = [
      ...(eventsQuery.data ?? []).map((event) => toEventItem(event, settings.timeZone)),
      ...(mirrorsQuery.data ?? []).map(toMirrorItem),
    ];
    return itemsByDay(list, days);
  }, [eventsQuery.data, mirrorsQuery.data, days, settings.timeZone]);

  const openEvent = (eventsQuery.data ?? []).find((event) => event.id === openEventId) ?? null;

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
    if (item.type === "mirror") router.push(item.mirror.href);
    else setOpenEventId(item.event.id);
  }

  function changeEvent(item: EventItem, range: TimeRange) {
    setChangeFailed(false);
    update.mutate({ id: item.event.id, patch: range }, { onError: () => setChangeFailed(true) });
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

  const failed = eventsQuery.isError || mirrorsQuery.isError;

  return (
    <div className="flex flex-col gap-5">
      <MarkSeenOnVisit section="calendar" />
      <PageHeader
        title={tNav("calendar")}
        description={t("description")}
        actions={
          canEdit && (
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
                view === option ? "bg-violet text-white" : "text-ink-soft hover:text-ink",
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
      </div>

      {(failed || changeFailed) && (
        <FormAlert>{changeFailed ? t("notices.changeFailed") : t("notices.loadFailed")}</FormAlert>
      )}

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
          onCreate={(day, range) => canEdit && setForm({ event: null, start: { day, range } })}
          onChangeEvent={canEdit ? changeEvent : () => {}}
        />
      )}

      <EventDetail
        event={openEvent}
        onClose={() => setOpenEventId(null)}
        readOnly={!canEdit}
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
      />
    </div>
  );
}

function MirrorToggle({
  pressed,
  tone,
  onToggle,
  icon,
  children,
}: {
  pressed: boolean;
  tone: "teal" | "gold";
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
        pressed
          ? tone === "teal"
            ? "border-teal/60 bg-teal/10 text-teal"
            : "border-gold/60 bg-gold/10 text-gold"
          : "border-line text-ink-muted hover:text-ink",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
