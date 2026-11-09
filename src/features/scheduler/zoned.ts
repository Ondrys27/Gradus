/**
 * Wall clock arithmetic in a named time zone that never touches the zone of
 * the machine it runs on (a server in UTC, a browser in Prague, a test in
 * either): every wall time is kept as plain numbers and every instant as a
 * UTC millisecond count. The scheduler's slots and the ICS parser both build
 * on it, so a DST change in the host's zone or the guest's never shifts a
 * slot by an hour.
 */

export type WallTime = {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
};

/** A calendar day, `YYYY-MM-DD`. */
export type Day = string;

const MINUTE = 60_000;
const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, found);
  }
  return found;
}

/** Whether Intl knows the zone (an IANA name such as Europe/Prague, or UTC). */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 64) return false;
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The wall clock an instant shows in the zone. */
export function wallOf(instantMs: number, timeZone: string): WallTime {
  const parts = formatter(timeZone).formatToParts(new Date(instantMs));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // Some engines write midnight as 24 with h23.
    hour: get("hour") % 24,
    minute: get("minute"),
  };
}

/** Minutes the zone is ahead of UTC at the instant. */
export function offsetMinutes(instantMs: number, timeZone: string): number {
  const wall = wallOf(instantMs, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const floored = Math.floor(instantMs / MINUTE) * MINUTE;
  return Math.round((asUtc - floored) / MINUTE);
}

/**
 * The instant the zone's wall clock shows `wall`. A wall time skipped by a
 * spring DST jump resolves to the moment just after the jump (02:30 → 03:30
 * in Prague); a time that happens twice in the autumn resolves to the first.
 */
export function instantOf(wall: WallTime, timeZone: string): number {
  const wanted = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  // The zone's offset half a day before and after; a change in between is a DST switch.
  const before = offsetMinutes(wanted - DAY_MS / 2, timeZone);
  const after = offsetMinutes(wanted + DAY_MS / 2, timeZone);
  const shows = (instant: number) => {
    const back = wallOf(instant, timeZone);
    return (
      back.year === wall.year &&
      back.month === wall.month &&
      back.day === wall.day &&
      back.hour === wall.hour &&
      back.minute === wall.minute
    );
  };
  const valid = [...new Set([before, after])]
    .map((offset) => wanted - offset * MINUTE)
    .filter(shows);
  // Twice in the autumn: the earlier instant.
  if (valid.length) return Math.min(...valid);
  // Skipped by a jump forward: read with the offset before the jump, it lands just after it.
  return wanted - before * MINUTE;
}

/** Whether the wall time exists in the zone (not skipped by a DST jump). */
export function wallExists(wall: WallTime, timeZone: string): boolean {
  const back = wallOf(instantOf(wall, timeZone), timeZone);
  return (
    back.year === wall.year &&
    back.month === wall.month &&
    back.day === wall.day &&
    back.hour === wall.hour &&
    back.minute === wall.minute
  );
}

const pad = (value: number, size = 2) => String(value).padStart(size, "0");

export function dayOf(wall: Pick<WallTime, "year" | "month" | "day">): Day {
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
}

/** The calendar day an instant falls on in the zone. */
export function dayIn(instantMs: number, timeZone: string): Day {
  return dayOf(wallOf(instantMs, timeZone));
}

export function parseDay(day: Day): { year: number; month: number; day: number } {
  const [year, month, date] = day.split("-").map(Number);
  return { year, month, day: date };
}

/** The day `count` days after (or before) `day`, by the calendar. */
export function addDays(day: Day, count: number): Day {
  const { year, month, day: date } = parseDay(day);
  const utc = new Date(Date.UTC(year, month - 1, date + count));
  return dayOf({ year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() });
}

/** 0 = Sunday … 6 = Saturday, like Date#getDay and Postgres extract(dow). */
export function weekdayOf(day: Day): number {
  const { year, month, day: date } = parseDay(day);
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay();
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: Day, b: Day): number {
  const x = parseDay(a);
  const y = parseDay(b);
  return Math.round(
    (Date.UTC(y.year, y.month - 1, y.day) - Date.UTC(x.year, x.month - 1, x.day)) / DAY_MS,
  );
}

/** `HH:mm` (or `HH:mm:ss`, as Postgres sends a time) as minutes of the day; 24:00 = 1440. */
export function minutesOfTime(time: string): number {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time.trim());
  if (!match) return Number.NaN;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59 || hours > 24 || (hours === 24 && minutes > 0)) return Number.NaN;
  return hours * 60 + minutes;
}

export function timeOfMinutes(total: number): string {
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/**
 * The instant of a day's wall clock minute in the zone; minute 1440 is the
 * next day's midnight, so "until 24:00" ends the day.
 */
export function instantAtMinute(day: Day, minute: number, timeZone: string): number {
  const target = minute >= 1440 ? addDays(day, Math.floor(minute / 1440)) : day;
  const rest = minute % 1440;
  const { year, month, day: date } = parseDay(target);
  return instantOf(
    { year, month, day: date, hour: Math.floor(rest / 60), minute: rest % 60 },
    timeZone,
  );
}

/** The instant the day starts (its midnight) in the zone. */
export function startOfDay(day: Day, timeZone: string): number {
  return instantAtMinute(day, 0, timeZone);
}
