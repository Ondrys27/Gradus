import { addDays, parseDay, weekdayOf, type Day } from "../zoned";

/**
 * The month calendar of the booking page (24.4) as plain data: the weeks of
 * a month with empty cells around it, and the months that have a free time.
 * Days are the guest's calendar days (`YYYY-MM-DD`), never the machine's.
 */

/** `YYYY-MM` */
export type Month = string;

export function monthOf(day: Day): Month {
  return day.slice(0, 7);
}

export function addMonths(month: Month, count: number): Month {
  const [year, value] = month.split("-").map(Number) as [number, number];
  const index = year * 12 + (value - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** The cells of a month, a week per row from `weekStartsOn` (0 = Sunday); null = outside the month. */
export function monthGrid(month: Month, weekStartsOn: number): Array<Day | null> {
  const first: Day = `${month}-01`;
  const lead = (weekdayOf(first) - weekStartsOn + 7) % 7;
  const cells: Array<Day | null> = Array.from({ length: lead }, () => null);
  for (let day = first; monthOf(day) === month; day = addDays(day, 1)) cells.push(day);
  while (cells.length % 7) cells.push(null);
  return cells;
}

/** The months from the first to the last day with a free time (at least the first one). */
export function bookableMonths(days: readonly Day[]): Month[] {
  if (!days.length) return [];
  const sorted = [...days].sort();
  const out: Month[] = [];
  for (let month = monthOf(sorted[0]!), guard = 0; month <= monthOf(sorted.at(-1)!) && guard < 24; guard++) {
    out.push(month);
    month = addMonths(month, 1);
  }
  return out;
}

/** The day number of a calendar day. */
export function dayNumber(day: Day): number {
  return parseDay(day).day;
}
