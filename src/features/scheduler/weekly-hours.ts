import { minutesOfTime, timeOfMinutes } from "./zoned";

/**
 * The weekly hours as the editor holds them: per weekday (0 = Sunday) a list
 * of intervals `HH:mm`. An end of 00:00 means midnight at the end of the day
 * (stored as 24:00), since a time input cannot show 24:00.
 */

export type HoursInterval = { start: string; end: string };
export type Week = Record<number, HoursInterval[]>;

export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export const MAX_INTERVALS_PER_DAY = 10;

const short = (time: string) => time.slice(0, 5);

export function emptyWeek(): Week {
  return Object.fromEntries(WEEKDAYS.map((day) => [day, []])) as unknown as Week;
}

export function rulesToWeek(
  rules: ReadonlyArray<{ weekday: number; start_time: string; end_time: string }>,
): Week {
  const week = emptyWeek();
  for (const rule of [...rules].sort((a, b) => a.start_time.localeCompare(b.start_time))) {
    if (!(rule.weekday in week)) continue;
    const end = short(rule.end_time) === "24:00" ? "00:00" : short(rule.end_time);
    week[rule.weekday].push({ start: short(rule.start_time), end });
  }
  return week;
}

/** Minutes of an end time: 00:00 is the end of the day. */
export function endMinutes(end: string): number {
  const minutes = minutesOfTime(end);
  return minutes === 0 ? 1440 : minutes;
}

export function weekToRules(
  week: Week,
): Array<{ weekday: number; start_time: string; end_time: string }> {
  return WEEKDAYS.flatMap((weekday) =>
    (week[weekday] ?? []).map((interval) => ({
      weekday,
      start_time: interval.start,
      end_time: timeOfMinutes(endMinutes(interval.end)),
    })),
  );
}

export type WeekIssue = { weekday: number; index: number; code: "order" | "overlap" | "format" };

/** Intervals that do not end after they start, or that overlap another of the day. */
export function weekIssues(week: Week): WeekIssue[] {
  const issues: WeekIssue[] = [];
  for (const weekday of WEEKDAYS) {
    const list = week[weekday] ?? [];
    const spans = list.map((interval) => ({
      from: minutesOfTime(interval.start),
      to: endMinutes(interval.end),
    }));
    spans.forEach((span, index) => {
      if (!Number.isFinite(span.from) || !Number.isFinite(span.to) || span.from >= 1440) {
        issues.push({ weekday, index, code: "format" });
      } else if (span.to <= span.from) {
        issues.push({ weekday, index, code: "order" });
      } else if (
        spans.some(
          (other, j) => j !== index && other.from < span.to && other.to > span.from && j < index,
        )
      ) {
        issues.push({ weekday, index, code: "overlap" });
      }
    });
  }
  return issues;
}

export function sameWeek(a: Week, b: Week): boolean {
  return JSON.stringify(weekToRules(a)) === JSON.stringify(weekToRules(b));
}

/** The next free hour after the day's last interval, for "add interval". */
export function nextInterval(list: readonly HoursInterval[]): HoursInterval {
  if (!list.length) return { start: "09:00", end: "17:00" };
  const last = Math.max(...list.map((interval) => endMinutes(interval.end)));
  const start = Math.min(last + 60, 1380);
  return { start: timeOfMinutes(start), end: timeOfMinutes(Math.min(start + 60, 1440) % 1440) };
}

/** Weekdays in the order the user's week starts (Monday or Sunday). */
export function orderedWeekdays(weekStartsOn: number): number[] {
  return WEEKDAYS.map((offset) => (weekStartsOn + offset) % 7);
}
