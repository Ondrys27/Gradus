import type { GuestDay, GuestSlot } from "./slots";
import { addDays, daysBetween, instantAtMinute, minutesOfTime, type Day } from "./zoned";

/**
 * The shared picker's grid (30.4, ui/slot-picker.tsx): a week of the
 * viewer's days, each with its times inside the host's hours — free (green)
 * or taken ("Full", never why) — and, where another day of the week has a
 * time this one lacks, a quiet cell outside the hours. Pure, Vitest.
 */

export type CellState = "free" | "busy" | "off";
export type GridCell = {
  day: Day;
  time: string;
  start: number;
  end: number | null;
  state: CellState;
};

/**
 * The picker's weeks are seven days in a row from the first day that has a
 * time (today, mostly), not calendar weeks: the first screen always shows a
 * whole week ahead, whatever day it is. Each column names its weekday.
 */
export function weeksOf(days: readonly GuestDay[]): Day[] {
  const withTimes = days
    .filter((day) => day.slots.length || day.busy?.length)
    .map((day) => day.day);
  if (!withTimes.length) return [];
  const sorted = [...withTimes].sort();
  const first = sorted[0];
  const weeks = new Set<Day>();
  for (const day of sorted) weeks.add(addDays(first, Math.floor(daysBetween(first, day) / 7) * 7));
  return [...weeks].sort();
}

/** The week of `weeks` that `day` is in (or the first). */
export function weekOfDay(weeks: readonly Day[], day: Day): Day | null {
  let found: Day | null = weeks[0] ?? null;
  for (const start of weeks) if (start <= day) found = start;
  return found && daysBetween(found, day) < 7 ? found : (weeks[0] ?? null);
}

export function weekDays(start: Day): Day[] {
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

/** A day: has a free time, only taken ones, or none (outside the hours). */
export function dayState(day: GuestDay | undefined): CellState {
  if (!day) return "off";
  if (day.slots.length) return "free";
  return day.busy?.length ? "busy" : "off";
}

/** A day's times, free and taken together, in clock order. */
export function dayCells(day: GuestDay): GridCell[] {
  const cells: GridCell[] = [
    ...day.slots.map((slot) => cellOf(day.day, slot, "free")),
    ...(day.busy ?? []).map((slot) => cellOf(day.day, slot, "busy")),
  ];
  return cells.sort((a, b) => a.start - b.start);
}

function cellOf(day: Day, slot: GuestSlot, state: CellState): GridCell {
  return { day, time: slot.time, start: slot.start, end: slot.end, state };
}

/**
 * The rows of a week: every clock time some day has, and for each day its
 * cell at that time — the free or taken one, or a quiet one outside the
 * hours (its start in the viewer's zone, so the app may still book it).
 */
export function weekGrid(
  days: readonly GuestDay[],
  weekStart: Day,
  timeZone: string,
): { days: Day[]; rows: Array<{ time: string; cells: GridCell[] }> } {
  const week = weekDays(weekStart);
  const byDay = new Map(days.map((day) => [day.day, day]));
  const cellsByDay = new Map<Day, Map<string, GridCell>>();
  const times = new Set<string>();
  for (const day of week) {
    const entry = byDay.get(day);
    const map = new Map<string, GridCell>();
    for (const cell of entry ? dayCells(entry) : []) {
      // Two instants at one clock time (the hour repeated in autumn): the first.
      if (!map.has(cell.time)) map.set(cell.time, cell);
      times.add(cell.time);
    }
    cellsByDay.set(day, map);
  }
  const rows = [...times].sort().map((time) => ({
    time,
    cells: week.map(
      (day): GridCell =>
        cellsByDay.get(day)?.get(time) ?? {
          day,
          time,
          start: instantAtMinute(day, minutesOfTime(time), timeZone),
          end: null,
          state: "off",
        },
    ),
  }));
  return { days: week, rows };
}

/**
 * What a time typed by hand is: one of the free times, a taken one, or
 * outside the offer (no such time at all). The app books the last two only
 * after "Book anyway".
 */
export function stateAt(days: readonly GuestDay[], start: number): CellState {
  for (const day of days) {
    if (day.slots.some((slot) => slot.start === start)) return "free";
    if (day.busy?.some((slot) => slot.start === start)) return "busy";
  }
  return "off";
}

/** The free slot at `start`, if it is one. */
export function freeSlotAt(days: readonly GuestDay[], start: number): GuestSlot | null {
  for (const day of days) {
    const slot = day.slots.find((item) => item.start === start);
    if (slot) return slot;
  }
  return null;
}
