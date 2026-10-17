import {
  MIN_CELL_ATTEMPTS,
  MIN_COUNTRY_ATTEMPTS,
  type StatRow,
} from "@/features/cold-calling/heatmap-logic";
import {
  formatIsoTime,
  formatTime,
  formatWeekdayLong,
  isoDateToLocal,
  toZonedWallClock,
  zonedWallClockToInstant,
  type FormatSettings,
  type IsoDate,
  type IsoTime,
} from "@/lib/format";

/**
 * What makes sense right now for someone who works with other people: is it a
 * time to call and meet, or a time to prepare? Deterministic and shared by the
 * server (Jarvis's prompts, suggestions, the morning brief) and the browser
 * (the after-hours notice on the dashboard and in Cold Calling). No zod here.
 *
 * The rules (CLAUDE.md → Jarvis):
 * - calls and meetings: working days 8:00–17:30 in the user's zone, never on a
 *   public holiday of the user's country (Czech list, with movable Easter)
 * - 12:00–13:00 is lunch: still inside the window, but not a preferred time
 * - when the shared call statistics of the user's country have enough data,
 *   their best hours on working days take precedence over the default
 * - outside the window: preparation (notes, tomorrow's plan, a list of people
 *   to call, e-mails to send in the morning, milestone tasks)
 */

/** Minutes after local midnight. */
export const WORK_START = 8 * 60;
export const WORK_END = 17 * 60 + 30;
export const LUNCH_START = 12 * 60;
export const LUNCH_END = 13 * 60;

/** Cells of good data a country needs before its hours take precedence. */
export const MIN_STATS_CELLS = 3;
/** The statistics may move the window only within these hours (the heatmap's range). */
const STATS_FIRST_HOUR = 7;
const STATS_LAST_HOUR = 20;
/** How far ahead the next window is looked for; two weeks cover any run of holidays. */
const LOOKAHEAD_DAYS = 15;
const DAY_MS = 86_400_000;

/** What fits outside the window, in the order Jarvis offers it. */
export const PREP_ACTIVITIES = [
  "notes",
  "planTomorrow",
  "callList",
  "morningEmails",
  "milestoneTasks",
] as const;
export type PrepActivity = (typeof PREP_ACTIVITIES)[number];

export const CZ_HOLIDAYS = [
  "newYear",
  "goodFriday",
  "easterMonday",
  "labourDay",
  "liberationDay",
  "cyrilMethodius",
  "janHus",
  "statehood",
  "independence",
  "freedomDay",
  "christmasEve",
  "christmasDay",
  "stStephen",
] as const;
export type Holiday = (typeof CZ_HOLIDAYS)[number];

/** Fixed Czech public holidays by `MM-DD`. */
const CZ_FIXED: Record<string, Holiday> = {
  "01-01": "newYear",
  "05-01": "labourDay",
  "05-08": "liberationDay",
  "07-05": "cyrilMethodius",
  "07-06": "janHus",
  "09-28": "statehood",
  "10-28": "independence",
  "11-17": "freedomDay",
  "12-24": "christmasEve",
  "12-25": "christmasDay",
  "12-26": "stStephen",
};

function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, as in the database. */
export function weekdayOf(date: IsoDate): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Easter Sunday of a Gregorian year (anonymous Gregorian algorithm). */
export function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The Czech public holiday on a date, or null. */
export function czechHoliday(date: IsoDate): Holiday | null {
  const fixed = CZ_FIXED[date.slice(5)];
  if (fixed) return fixed;
  const easter = easterSunday(Number(date.slice(0, 4)));
  if (date === addDays(easter, -2)) return "goodFriday";
  if (date === addDays(easter, 1)) return "easterMonday";
  return null;
}

/**
 * Holidays of the user's country. Only the Czech list exists so far; an
 * account without a country in the Czech zone counts as Czech.
 */
export function holidayOn(date: IsoDate, country: string | null, timeZone: string): Holiday | null {
  const code = country ?? (timeZone === "Europe/Prague" ? "CZ" : null);
  return code === "CZ" ? czechHoliday(date) : null;
}

/** Best hours per weekday (1–5) from the shared statistics, or null without enough data. */
export type BestHours = Map<number, number[]>;

/**
 * The hours worth calling by the country's real results: cells with enough
 * attempts on working days whose meeting share is at least the average. Null
 * when the country has too little data, so the default applies.
 */
export function bestHoursFromStats(stats: readonly StatRow[] | null | undefined): BestHours | null {
  if (!stats?.length) return null;
  const total = stats.reduce((sum, row) => sum + row.attempts, 0);
  if (total < MIN_COUNTRY_ATTEMPTS) return null;
  const cells = stats.filter(
    (row) =>
      row.attempts >= MIN_CELL_ATTEMPTS &&
      row.day_of_week >= 1 &&
      row.day_of_week <= 5 &&
      row.hour >= STATS_FIRST_HOUR &&
      row.hour <= STATS_LAST_HOUR,
  );
  if (cells.length < MIN_STATS_CELLS) return null;
  const attempts = cells.reduce((sum, row) => sum + row.attempts, 0);
  const meetings = cells.reduce((sum, row) => sum + row.meetings, 0);
  if (meetings === 0) return null;
  const average = meetings / attempts;
  const best: BestHours = new Map();
  for (const row of cells) {
    if (row.meetings / row.attempts < average) continue;
    best.set(row.day_of_week, [...(best.get(row.day_of_week) ?? []), row.hour]);
  }
  for (const hours of best.values()) hours.sort((a, b) => a - b);
  return best;
}

type Interval = [number, number];

function merge(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [start, end] of sorted) {
    const last = out[out.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

const hourIntervals = (hours: readonly number[]): Interval[] =>
  merge(hours.map((hour) => [hour * 60, hour * 60 + 60]));

type DayPlan = {
  holiday: Holiday | null;
  workingDay: boolean;
  /** When people may be reached. */
  window: Interval[];
  /** When it is best to reach them. */
  preferred: Interval[];
};

function planDay(
  date: IsoDate,
  country: string | null,
  timeZone: string,
  best: BestHours | null,
): DayPlan {
  const weekday = weekdayOf(date);
  const holiday = holidayOn(date, country, timeZone);
  const workingDay = weekday >= 1 && weekday <= 5 && !holiday;
  if (!workingDay) return { holiday, workingDay, window: [], preferred: [] };
  const statsHours = best?.get(weekday) ?? [];
  if (statsHours.length) {
    const preferred = hourIntervals(statsHours);
    return {
      holiday,
      workingDay,
      window: merge([[WORK_START, WORK_END], ...preferred]),
      preferred,
    };
  }
  return {
    holiday,
    workingDay,
    window: [[WORK_START, WORK_END]],
    preferred: [
      [WORK_START, LUNCH_START],
      [LUNCH_END, WORK_END],
    ],
  };
}

function hhmm(minutes: number): IsoTime {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** The first instant at or after `now` inside one of the day plans' intervals. */
function nextStart(
  now: Date,
  from: IsoDate,
  timeZone: string,
  intervalsOf: (date: IsoDate) => Interval[],
): { at: Date; open: boolean } | null {
  for (let offset = 0; offset < LOOKAHEAD_DAYS; offset++) {
    const date = addDays(from, offset);
    for (const [start, end] of intervalsOf(date)) {
      const startAt = zonedWallClockToInstant(date, hhmm(start), timeZone);
      const endAt = zonedWallClockToInstant(date, hhmm(end), timeZone);
      if (now >= startAt && now < endAt) return { at: now, open: true };
      if (startAt > now) return { at: startAt, open: false };
    }
  }
  return null;
}

export type ClosedReason =
  "weekend" | "holiday" | "beforeHours" | "lunch" | "offPeak" | "afterHours";

export type TimeWindow = {
  /** The user's local date, time (`HH:mm`) and weekday (0 = Sunday). */
  date: IsoDate;
  time: IsoTime;
  weekday: number;
  holiday: Holiday | null;
  workingDay: boolean;
  /** Inside 8:00–17:30 of a working day. */
  workingHours: boolean;
  /** Calls and meetings make sense now. */
  open: boolean;
  /** …and it is one of the best times for them. */
  preferred: boolean;
  /** Where the preferred hours come from. */
  source: "default" | "stats";
  /** Why it is not a preferred time now; null when it is. */
  reason: ClosedReason | null;
  /** When the window opens next; null while it is open. */
  nextOpenAt: Date | null;
  /** The next preferred time; `now` itself while it is one. */
  nextPreferredAt: Date | null;
  /** What to do instead while the window is closed; empty while it is open. */
  prepare: readonly PrepActivity[];
  /** Today's preferred times to reach people, local `HH:mm` pairs; empty on a day off. */
  preferredToday: [IsoTime, IsoTime][];
};

export type TimeWindowInput = {
  now: Date;
  timeZone: string;
  /** ISO 3166-1 alpha-2, for holidays. */
  country: string | null;
  /** The shared call statistics of the user's country, when loaded. */
  stats?: readonly StatRow[] | null;
};

export function timeWindow(input: TimeWindowInput): TimeWindow {
  const { now, timeZone, country } = input;
  const wall = toZonedWallClock(now, timeZone);
  const date = `${wall.getFullYear()}-${String(wall.getMonth() + 1).padStart(2, "0")}-${String(wall.getDate()).padStart(2, "0")}`;
  const minutes = wall.getHours() * 60 + wall.getMinutes();
  const best = bestHoursFromStats(input.stats);
  const plans = new Map<IsoDate, DayPlan>();
  const plan = (day: IsoDate) => {
    let found = plans.get(day);
    if (!found) {
      found = planDay(day, country, timeZone, best);
      plans.set(day, found);
    }
    return found;
  };

  const today = plan(date);
  const window = nextStart(now, date, timeZone, (day) => plan(day).window);
  const preferred = nextStart(now, date, timeZone, (day) => plan(day).preferred);
  const open = window?.open ?? false;
  const isPreferred = preferred?.open ?? false;
  const workingHours = today.workingDay && minutes >= WORK_START && minutes < WORK_END;

  let reason: ClosedReason | null = null;
  if (!isPreferred) {
    if (!today.workingDay) reason = today.holiday ? "holiday" : "weekend";
    else if (open) reason = minutes >= LUNCH_START && minutes < LUNCH_END ? "lunch" : "offPeak";
    else if (today.window.length && minutes < today.window[0][0]) reason = "beforeHours";
    else reason = "afterHours";
  }

  return {
    date,
    time: hhmm(minutes),
    weekday: weekdayOf(date),
    holiday: today.holiday,
    workingDay: today.workingDay,
    workingHours,
    open,
    preferred: isPreferred,
    source: best ? "stats" : "default",
    reason,
    nextOpenAt: open ? null : (window?.at ?? null),
    nextPreferredAt: preferred?.at ?? null,
    prepare: open ? [] : PREP_ACTIVITIES,
    preferredToday: today.preferred.map(([start, end]) => [hhmm(start), hhmm(end)]),
  };
}

const PREP_WORDS: Record<PrepActivity, string> = {
  notes: "notes",
  planTomorrow: "the plan for the next working day",
  callList: "the list of people to call",
  morningEmails: "e-mails to send in the morning",
  milestoneTasks: "milestone tasks",
};

const REASON_WORDS: Record<ClosedReason, string> = {
  weekend: "weekend",
  holiday: "public holiday",
  beforeHours: "before working hours",
  lunch: "lunch time",
  offPeak: "not one of the best hours",
  afterHours: "after working hours",
};

/** A day and time for the model, e.g. "Monday 2026-10-19 at 08:00", in the user's zone and format. */
export function describeWhen(at: Date, settings: FormatSettings): string {
  const wall = toZonedWallClock(at, settings.timeZone);
  const date = `${wall.getFullYear()}-${String(wall.getMonth() + 1).padStart(2, "0")}-${String(wall.getDate()).padStart(2, "0")}`;
  return `${formatWeekdayLong(isoDateToLocal(date), "en")} ${date} at ${formatTime(at, settings)}`;
}

/**
 * The time lines for Jarvis's context: local time and weekday, working hours,
 * the window for reaching people and what to do instead when it is closed.
 */
export function describeTimeWindow(
  window: TimeWindow,
  now: Date,
  settings: FormatSettings,
): string {
  const weekday = formatWeekdayLong(isoDateToLocal(window.date), "en");
  const lines = [
    `Local time now: ${formatTime(now, settings)}, ${weekday}${window.holiday ? " (public holiday)" : ""}. Working hours now: ${window.workingHours ? "yes" : "no"}.`,
  ];
  const source =
    window.source === "stats"
      ? " Preferred hours come from the real call results in the user's country."
      : " Preferred: not 12:00–13:00.";
  if (window.preferred) {
    lines.push(`Calls and meetings: a good time now.${source}`);
  } else if (window.open) {
    const next = window.nextPreferredAt
      ? `; better from ${describeWhen(window.nextPreferredAt, settings)}`
      : "";
    lines.push(
      `Calls and meetings: possible now, but ${REASON_WORDS[window.reason ?? "lunch"]}${next}.${source}`,
    );
  } else {
    const next = window.nextOpenAt
      ? ` Next time to reach people: ${describeWhen(window.nextOpenAt, settings)}.`
      : "";
    lines.push(
      `Calls and meetings: not now (${REASON_WORDS[window.reason ?? "afterHours"]}); people mostly do not pick up.${next} Good to do now: ${window.prepare.map((key) => PREP_WORDS[key]).join(", ")}.`,
    );
  }
  return lines.join("\n");
}

/**
 * Today as a plan for the morning brief: on a working day the best times to
 * call and meet, on a day off the next time to reach people and preparation.
 */
export function describeDayPlan(window: TimeWindow, settings: FormatSettings): string {
  if (window.workingDay) {
    const hours = window.preferredToday
      .map(([start, end]) => `${formatIsoTime(start, settings)}–${formatIsoTime(end, settings)}`)
      .join(", ");
    return `Today is a working day. Best times for calls and meetings: ${hours}. Before and after them: preparation.`;
  }
  const next = window.nextOpenAt
    ? ` Next time to reach people: ${describeWhen(window.nextOpenAt, settings)}.`
    : "";
  return `Today is a ${window.holiday ? "public holiday" : "weekend day"}: no calls or meetings, people mostly do not pick up.${next} Plan preparation instead: ${PREP_ACTIVITIES.map((key) => PREP_WORDS[key]).join(", ")}.`;
}
