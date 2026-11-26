import {
  instantToZonedParts,
  zonedWallClockToInstant,
  type IsoDate,
  type IsoTime,
} from "@/lib/format";
import { holidayOn, weekdayOf } from "@/features/grady/time-window";

/**
 * "Find a common time" (30.3): the windows in working hours when every
 * chosen person is free, from the busy times the account may see. Pure and
 * deterministic (Vitest); the day boundaries and working hours are in the
 * viewer's zone, never the machine's.
 */

export type BusyInterval = { personId: string; startMs: number; endMs: number; allDay?: boolean };
export type FreeWindow = { day: IsoDate; startMs: number; endMs: number };

export type CommonTimeInput = {
  days: readonly IsoDate[];
  timeZone: string;
  /** Working hours on each day, "HH:MM". */
  workStart: IsoTime;
  workEnd: IsoTime;
  durationMin: number;
  /** Windows start on this grid (minutes from the working day's start). */
  stepMin?: number;
  busy: readonly BusyInterval[];
  /** Nothing before this moment. */
  nowMs: number;
  /** Weekends and the public holidays of this country are left out. */
  country?: string | null;
};

const MINUTE = 60_000;
export const COMMON_TIME_DURATIONS = [15, 30, 45, 60, 90, 120] as const;
export const COMMON_TIME_DAYS = 7;

/** Merges overlapping intervals (sorted by start). */
export function mergeIntervals(intervals: ReadonlyArray<{ startMs: number; endMs: number }>) {
  const sorted = intervals
    .filter((interval) => interval.endMs > interval.startMs)
    .map((interval) => ({ startMs: interval.startMs, endMs: interval.endMs }))
    .sort((a, b) => a.startMs - b.startMs);
  const merged: { startMs: number; endMs: number }[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.startMs <= last.endMs) last.endMs = Math.max(last.endMs, interval.endMs);
    else merged.push(interval);
  }
  return merged;
}

/** Whether a day counts: a working day that is not a public holiday. */
export function isWorkingDay(day: IsoDate, timeZone: string, country?: string | null): boolean {
  const weekday = weekdayOf(day);
  if (weekday === 0 || weekday === 6) return false;
  return holidayOn(day, country ?? null, timeZone) === null;
}

/**
 * The free windows, at least `durationMin` long, per day. All-day busy times
 * (an out-of-office day, a holiday) block nothing here, as in the scheduler.
 */
export function findCommonWindows(input: CommonTimeInput): FreeWindow[] {
  const step = Math.max(5, input.stepMin ?? 15) * MINUTE;
  const duration = Math.max(5, input.durationMin) * MINUTE;
  const busy = mergeIntervals(input.busy.filter((interval) => !interval.allDay));
  const windows: FreeWindow[] = [];

  for (const day of input.days) {
    if (!isWorkingDay(day, input.timeZone, input.country)) continue;
    const dayStart = zonedWallClockToInstant(day, input.workStart, input.timeZone).getTime();
    const dayEnd = zonedWallClockToInstant(day, input.workEnd, input.timeZone).getTime();
    if (dayEnd <= dayStart) continue;
    // Past time is gone; the first start is on the grid of the working day.
    let cursor = dayStart;
    if (input.nowMs > cursor) cursor = dayStart + Math.ceil((input.nowMs - dayStart) / step) * step;

    for (const block of busy) {
      if (block.endMs <= cursor) continue;
      if (block.startMs >= dayEnd) break;
      if (block.startMs - cursor >= duration) {
        windows.push({ day, startMs: cursor, endMs: Math.min(block.startMs, dayEnd) });
      }
      // The next start after a busy block snaps forward to the grid.
      cursor = Math.max(cursor, dayStart + Math.ceil((block.endMs - dayStart) / step) * step);
      if (cursor >= dayEnd) break;
    }
    if (dayEnd - cursor >= duration) windows.push({ day, startMs: cursor, endMs: dayEnd });
  }
  return windows.filter((window) => window.endMs - window.startMs >= duration);
}

/** The start times inside a window a meeting of `durationMin` can take, on the step grid. */
export function startsInWindow(window: FreeWindow, durationMin: number, stepMin = 15): number[] {
  const out: number[] = [];
  const duration = durationMin * MINUTE;
  for (let at = window.startMs; at + duration <= window.endMs; at += stepMin * MINUTE) out.push(at);
  return out;
}

/** The next `count` days from `today`, in the viewer's zone. */
export function nextDays(today: IsoDate, count: number): IsoDate[] {
  const out: IsoDate[] = [];
  const start = Date.parse(`${today}T12:00:00Z`);
  for (let index = 0; index < count; index += 1) {
    out.push(new Date(start + index * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

/** The busy rows of calendar_people_busy() split into what we know and who shares nothing. */
export function splitBusy(
  rows: ReadonlyArray<{
    person_id: string;
    known: boolean;
    starts_at: string | null;
    ends_at: string | null;
    all_day: boolean | null;
  }>,
): { busy: BusyInterval[]; unknown: string[] } {
  const busy: BusyInterval[] = [];
  const unknown = new Set<string>();
  for (const row of rows) {
    if (!row.known) {
      unknown.add(row.person_id);
      continue;
    }
    if (!row.starts_at || !row.ends_at) continue;
    const startMs = Date.parse(row.starts_at);
    const endMs = Date.parse(row.ends_at);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    busy.push({ personId: row.person_id, startMs, endMs, allDay: Boolean(row.all_day) });
  }
  return { busy, unknown: [...unknown] };
}

/** The day of an instant in the viewer's zone (for grouping windows). */
export function dayOf(ms: number, timeZone: string): IsoDate {
  return instantToZonedParts(new Date(ms), timeZone).date;
}
