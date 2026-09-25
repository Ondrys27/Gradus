import { addDays, addMonths, addWeeks, endOfMonth, startOfMonth, startOfWeek } from "date-fns";
import type { Tone } from "@/components/ui/tone";
import {
  instantToZonedParts,
  isoDateToLocal,
  localToIsoDate,
  zonedWallClockToInstant,
  type IsoDate,
  type WeekStart,
} from "@/lib/format";
import type {
  CalendarEvent,
  CalendarItem,
  CalendarView,
  EventItem,
  EventKind,
  MirrorItem,
  MirrorCalendarItem,
} from "./types";

export const DEFAULT_VIEW: CalendarView = "month";
/** A timed event without an end lasts this long on screen. */
export const DEFAULT_DURATION_MIN = 60;
/** Drag and tap positions snap to this grid. */
export const SNAP_MIN = 15;
/** The shortest block drawn in a timeline, so it can still be tapped. */
export const MIN_BLOCK_MIN = 30;
export const DAY_MIN = 24 * 60;

const MINUTE_MS = 60_000;

/** Legacy types (call, reminder, other) show as the closest of the three. */
export function eventKind(kind: CalendarEvent["kind"]): EventKind {
  if (kind === "meeting" || kind === "call") return "meeting";
  if (kind === "task") return "task";
  return "deadline";
}

export const KIND_TONE: Record<EventKind, Tone> = {
  meeting: "violet",
  task: "teal",
  deadline: "gold",
};

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

function shiftDays(day: IsoDate, amount: number): IsoDate {
  return localToIsoDate(addDays(isoDateToLocal(day), amount));
}

export function addDaysIso(day: IsoDate, amount: number): IsoDate {
  return shiftDays(day, amount);
}

/** Days shown by a view around `cursor`. The month grid covers whole weeks. */
export function viewDays(view: CalendarView, cursor: IsoDate, weekStartsOn: WeekStart): IsoDate[] {
  const date = isoDateToLocal(cursor);
  if (view === "day") return [cursor];
  if (view === "week") {
    const first = startOfWeek(date, { weekStartsOn });
    return Array.from({ length: 7 }, (_, index) => localToIsoDate(addDays(first, index)));
  }
  const first = startOfWeek(startOfMonth(date), { weekStartsOn });
  const last = endOfMonth(date);
  const days: IsoDate[] = [];
  for (let day = first; day <= last || days.length % 7 !== 0; day = addDays(day, 1)) {
    days.push(localToIsoDate(day));
  }
  return days;
}

/** Moves the cursor one page: a day, a week or a month. */
export function shiftCursor(view: CalendarView, cursor: IsoDate, step: 1 | -1): IsoDate {
  const date = isoDateToLocal(cursor);
  if (view === "day") return localToIsoDate(addDays(date, step));
  if (view === "week") return localToIsoDate(addWeeks(date, step));
  return localToIsoDate(addMonths(date, step));
}

/** The instants bounding whole days in the user's zone; `to` is exclusive. */
export function dayRangeToInstants(
  firstDay: IsoDate,
  lastDay: IsoDate,
  timeZone: string,
): { from: string; to: string } {
  return {
    from: zonedWallClockToInstant(firstDay, "00:00", timeZone).toISOString(),
    to: zonedWallClockToInstant(shiftDays(lastDay, 1), "00:00", timeZone).toISOString(),
  };
}

export function isSameMonth(day: IsoDate, cursor: IsoDate): boolean {
  return day.slice(0, 7) === cursor.slice(0, 7);
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(DAY_MIN - 1, minutes));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

/**
 * An all-day event starts at the user's midnight of its first day; when it has
 * an end, that is the midnight of its last day.
 */
export function toEventItem(event: CalendarEvent, timeZone: string): EventItem {
  const kind = eventKind(event.kind);
  const start = new Date(event.starts_at);
  const first = instantToZonedParts(start, timeZone).date;

  if (event.all_day) {
    const last = event.ends_at
      ? instantToZonedParts(new Date(event.ends_at), timeZone).date
      : first;
    return {
      type: "event",
      key: `event:${event.id}`,
      title: event.title,
      tone: KIND_TONE[kind],
      allDay: true,
      firstDay: first,
      lastDay: last < first ? first : last,
      event,
      kind,
      startMs: start.getTime(),
      endMs: event.ends_at ? new Date(event.ends_at).getTime() : start.getTime(),
    };
  }

  const startMs = start.getTime();
  const endMs = event.ends_at
    ? new Date(event.ends_at).getTime()
    : startMs + DEFAULT_DURATION_MIN * MINUTE_MS;
  // An event ending exactly at midnight does not touch the next day.
  const last = endMs > startMs ? instantToZonedParts(new Date(endMs - 1), timeZone).date : first;
  return {
    type: "event",
    key: `event:${event.id}`,
    title: event.title,
    tone: KIND_TONE[kind],
    allDay: false,
    firstDay: first,
    lastDay: last < first ? first : last,
    event,
    kind,
    startMs,
    endMs,
  };
}

export function toMirrorItem(mirror: MirrorItem): MirrorCalendarItem {
  return {
    type: "mirror",
    key: `${mirror.source}:${mirror.id}`,
    title: mirror.title,
    tone: mirror.source === "task" ? "teal" : "gold",
    allDay: true,
    firstDay: mirror.date,
    lastDay: mirror.date,
    mirror,
  };
}

function compareItems(a: CalendarItem, b: CalendarItem): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  if (a.type === "event" && b.type === "event" && a.startMs !== b.startMs) {
    return a.startMs - b.startMs;
  }
  if (a.type !== b.type) return a.type === "event" ? -1 : 1;
  return a.title.localeCompare(b.title);
}

/** Items per day for the given days: all-day first, then by start time. */
export function itemsByDay(items: CalendarItem[], days: IsoDate[]): Map<IsoDate, CalendarItem[]> {
  const map = new Map<IsoDate, CalendarItem[]>(days.map((day) => [day, []]));
  for (const item of items) {
    for (const day of days) {
      if (day >= item.firstDay && day <= item.lastDay) map.get(day)!.push(item);
    }
  }
  for (const list of map.values()) list.sort(compareItems);
  return map;
}

/** Up to three coloured dots, plus a grey one when there are more. */
export function dotsForDay(items: CalendarItem[]): {
  tones: { tone: Tone; mirror: boolean }[];
  more: boolean;
} {
  return {
    tones: items.slice(0, 3).map((item) => ({ tone: item.tone, mirror: item.type === "mirror" })),
    more: items.length > 3,
  };
}

// ---------------------------------------------------------------------------
// Timeline layout
// ---------------------------------------------------------------------------

export type PositionedItem = {
  item: EventItem;
  /** Minutes from midnight of the shown day. */
  top: number;
  height: number;
  column: number;
  columns: number;
};

/** Minute of the day an instant falls on, or the day's edge when it is on another day. */
function minuteOnDay(instantMs: number, day: IsoDate, timeZone: string) {
  const parts = instantToZonedParts(new Date(instantMs), timeZone);
  if (parts.date < day) return 0;
  if (parts.date > day) return DAY_MIN;
  return toMinutes(parts.time);
}

/** Places the timed items of one day side by side where they overlap. */
export function layoutDay(items: CalendarItem[], day: IsoDate, timeZone: string): PositionedItem[] {
  const boxes = items
    .filter((item): item is EventItem => item.type === "event" && !item.allDay)
    .map((item) => {
      const start = minuteOnDay(item.startMs, day, timeZone);
      let end = minuteOnDay(item.endMs, day, timeZone);
      end = Math.max(end, start + MIN_BLOCK_MIN);
      const top = Math.min(start, DAY_MIN - MIN_BLOCK_MIN);
      return { item, top, end: Math.min(DAY_MIN, Math.max(end, top + MIN_BLOCK_MIN)) };
    })
    .sort((a, b) => a.top - b.top || b.end - a.end);

  const result: PositionedItem[] = [];
  let cluster: { box: (typeof boxes)[number]; column: number }[] = [];
  let clusterEnd = 0;
  const columnEnds: number[] = [];

  const flush = () => {
    const columns = columnEnds.length;
    for (const { box, column } of cluster) {
      result.push({ item: box.item, top: box.top, height: box.end - box.top, column, columns });
    }
    cluster = [];
    columnEnds.length = 0;
  };

  for (const box of boxes) {
    if (cluster.length > 0 && box.top >= clusterEnd) flush();
    let column = columnEnds.findIndex((end) => end <= box.top);
    if (column === -1) column = columnEnds.length;
    columnEnds[column] = box.end;
    cluster.push({ box, column });
    clusterEnd = Math.max(clusterEnd, box.end);
  }
  flush();
  return result;
}

// ---------------------------------------------------------------------------
// Editing by dragging
// ---------------------------------------------------------------------------

export function snapMinutes(minutes: number, mode: "round" | "floor" = "round"): number {
  const steps = minutes / SNAP_MIN;
  return (mode === "floor" ? Math.floor(steps) : Math.round(steps)) * SNAP_MIN;
}

/** The instant of a minute of a day; minute 1440 is the next midnight. */
export function instantAt(day: IsoDate, minutes: number, timeZone: string): Date {
  if (minutes >= DAY_MIN) return zonedWallClockToInstant(shiftDays(day, 1), "00:00", timeZone);
  return zonedWallClockToInstant(day, minutesToTime(minutes), timeZone);
}

export type TimeRange = { starts_at: string; ends_at: string };

/** A new event dragged (or tapped) out on a day's axis. */
export function rangeFromDrag(
  day: IsoDate,
  anchorMin: number,
  currentMin: number,
  timeZone: string,
): TimeRange {
  let start = Math.min(anchorMin, currentMin);
  let end = Math.max(anchorMin, currentMin);
  if (end - start < SNAP_MIN) end = start + DEFAULT_DURATION_MIN;
  start = Math.max(0, Math.min(start, DAY_MIN - SNAP_MIN));
  end = Math.min(DAY_MIN, end);
  return {
    starts_at: instantAt(day, start, timeZone).toISOString(),
    ends_at: instantAt(day, end, timeZone).toISOString(),
  };
}

/** Moves a timed event to a new day and start minute, keeping its length. */
export function movedRange(
  item: EventItem,
  day: IsoDate,
  startMin: number,
  timeZone: string,
): TimeRange {
  const start = instantAt(day, Math.max(0, Math.min(startMin, DAY_MIN - SNAP_MIN)), timeZone);
  const length = Math.max(SNAP_MIN * MINUTE_MS, item.endMs - item.startMs);
  return {
    starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + length).toISOString(),
  };
}

/** Drags the end of a timed event; the end stays at least one step after the start. */
export function resizedRange(
  item: EventItem,
  day: IsoDate,
  endMin: number,
  timeZone: string,
): TimeRange {
  const start = new Date(item.startMs);
  const earliest = start.getTime() + SNAP_MIN * MINUTE_MS;
  const end = Math.max(earliest, instantAt(day, Math.min(DAY_MIN, endMin), timeZone).getTime());
  return { starts_at: start.toISOString(), ends_at: new Date(end).toISOString() };
}
