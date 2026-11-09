import {
  addDays,
  dayOf,
  daysBetween,
  instantOf,
  isValidTimeZone,
  parseDay,
  startOfDay,
  wallOf,
  weekdayOf,
  type Day,
  type WallTime,
} from "../zoned";

/**
 * Reading a subscribed calendar (an iCalendar feed: Google's secret iCal
 * address, Apple, Outlook) into busy intervals. Only times are kept, never a
 * title, a description or who else is invited: the scheduler needs to know
 * when the person is busy, nothing more. Pure and deterministic; a broken
 * event is skipped, the parser never throws.
 */

/** A busy stretch in UTC. All-day events keep the flag (drawn as such, merged apart). */
export type BusyInterval = { start: string; end: string; allDay?: true };

/** A value of DTSTART, DTEND, EXDATE, RDATE or RECURRENCE-ID. */
export type IcsTime =
  | { kind: "date"; day: Day }
  | { kind: "utc"; ms: number }
  /** A wall clock time; `tz` null = floating (or an unknown zone): the default zone applies. */
  | { kind: "local"; wall: WallTime; tz: string | null };

export type IcsDuration = { days: number; ms: number };

export type IcsRule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count: number | null;
  until: IcsTime | null;
  /** 0 = Sunday … 6 = Saturday; `nth` 0 = every one, else 1…53 / −1…−53. */
  byDay: { weekday: number; nth: number }[];
  byMonthDay: number[];
  byMonth: number[];
  weekStart: number;
};

export type IcsEvent = {
  uid: string | null;
  start: IcsTime;
  end: IcsTime | null;
  duration: IcsDuration | null;
  rule: IcsRule | null;
  exdates: IcsTime[];
  rdates: IcsTime[];
  recurrenceId: IcsTime | null;
  cancelled: boolean;
  transparent: boolean;
  allDay: boolean;
};

// ---------------------------------------------------------------------------
// Lines and properties
// ---------------------------------------------------------------------------

type Property = { name: string; params: Record<string, string>; value: string };

/** Unfolds continuation lines (a line starting with a space or a tab belongs to the one before). */
function unfold(text: string): string[] {
  const raw = text.replace(/\r\n?/g, "\n").split("\n");
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

/** `NAME;PARAM=a;PARAM2="b:c":value`; a colon inside quotes is not the separator. */
function parseProperty(line: string): Property | null {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') quoted = !quoted;
    else if (char === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts: string[] = [];
  let current = "";
  quoted = false;
  for (const char of head) {
    if (char === '"') quoted = !quoted;
    if (char === ";" && !quoted) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  parts.push(current);
  const name = parts[0].trim().toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    params[part.slice(0, eq).trim().toUpperCase()] = part
      .slice(eq + 1)
      .trim()
      .replace(/^"|"$/g, "");
  }
  return { name, params, value: value.trim() };
}

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------

/** Outlook writes Windows zone names; the common ones, to IANA. */
const WINDOWS_ZONES: Record<string, string> = {
  "central europe standard time": "Europe/Prague",
  "central european standard time": "Europe/Warsaw",
  "w. europe standard time": "Europe/Berlin",
  "romance standard time": "Europe/Paris",
  "gmt standard time": "Europe/London",
  "greenwich standard time": "Atlantic/Reykjavik",
  "e. europe standard time": "Europe/Chisinau",
  "fle standard time": "Europe/Helsinki",
  "gtb standard time": "Europe/Bucharest",
  "russian standard time": "Europe/Moscow",
  "turkey standard time": "Europe/Istanbul",
  "eastern standard time": "America/New_York",
  "central standard time": "America/Chicago",
  "mountain standard time": "America/Denver",
  "pacific standard time": "America/Los_Angeles",
  utc: "UTC",
  "coordinated universal time": "UTC",
  gmt: "UTC",
  "tokyo standard time": "Asia/Tokyo",
  "india standard time": "Asia/Kolkata",
  "china standard time": "Asia/Shanghai",
  "singapore standard time": "Asia/Singapore",
  "arabian standard time": "Asia/Dubai",
  "aus eastern standard time": "Australia/Sydney",
};

/** The IANA zone of a TZID, or null when it is unknown (then the default zone applies). */
export function resolveTimeZone(tzid: string | undefined): string | null {
  if (!tzid) return null;
  const clean = tzid.trim().replace(/^"|"$/g, "");
  if (!clean) return null;
  const windows = WINDOWS_ZONES[clean.toLowerCase()];
  if (windows) return windows;
  if (isValidTimeZone(clean)) return clean;
  // "/mozilla.org/20050126_1/Europe/Prague", "/softwarestudio.org/Olson_20011030_5/America/New_York"
  const segments = clean.split("/").filter(Boolean);
  for (const size of [3, 2, 1]) {
    if (segments.length < size) continue;
    const tail = segments.slice(-size).join("/");
    if (/[A-Za-z]/.test(tail) && isValidTimeZone(tail) && (size > 1 || tail === "UTC")) return tail;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

const DATE_TIME = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/;

function validDay(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseTime(value: string, params: Record<string, string>): IcsTime | null {
  const match = DATE_TIME.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, , z] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (!validDay(year, month, day)) return null;
  if (h === undefined || params.VALUE === "DATE") {
    return { kind: "date", day: dayOf({ year, month, day }) };
  }
  const hour = Number(h);
  const minute = Number(mi);
  if (hour > 23 || minute > 59) return null;
  if (z) return { kind: "utc", ms: Date.UTC(year, month - 1, day, hour, minute) };
  return {
    kind: "local",
    wall: { year, month, day, hour, minute },
    tz: resolveTimeZone(params.TZID),
  };
}

function parseTimeList(value: string, params: Record<string, string>): IcsTime[] {
  return value
    .split(",")
    .map((item) => parseTime(item, params))
    .filter((item): item is IcsTime => item !== null);
}

/** `P1D`, `PT1H30M`, `P2W`, `-PT15M`. */
export function parseDuration(value: string): IcsDuration | null {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    value.trim(),
  );
  if (!match || value.trim().replace(/^[+-]/, "") === "P" || /T$/.test(value.trim())) return null;
  const [, sign, w, d, h, m, s] = match;
  const days = Number(w ?? 0) * 7 + Number(d ?? 0);
  const ms = (Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0)) * 1000;
  if (sign === "-") return null;
  return { days, ms };
}

const WEEKDAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRule(value: string): IcsRule | null {
  const parts = new Map<string, string>();
  for (const part of value.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) parts.set(part.slice(0, eq).trim().toUpperCase(), part.slice(eq + 1).trim());
  }
  const freq = parts.get("FREQ")?.toUpperCase();
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return null;
  const interval = Number(parts.get("INTERVAL") ?? 1);
  if (!Number.isInteger(interval) || interval < 1 || interval > 1000) return null;
  const countRaw = parts.get("COUNT");
  const count = countRaw === undefined ? null : Number(countRaw);
  if (count !== null && (!Number.isInteger(count) || count < 1)) return null;
  const untilRaw = parts.get("UNTIL");
  const until = untilRaw ? parseTime(untilRaw, {}) : null;
  if (untilRaw && !until) return null;

  const byDay: IcsRule["byDay"] = [];
  for (const item of (parts.get("BYDAY") ?? "").split(",").filter(Boolean)) {
    const match = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(item.trim());
    if (!match) return null;
    const nth = match[1] ? Number(match[1]) : 0;
    if (Math.abs(nth) > 53) return null;
    byDay.push({ weekday: WEEKDAYS[match[2].toUpperCase()], nth });
  }
  const numbers = (key: string, min: number, max: number) => {
    const list: number[] = [];
    for (const item of (parts.get(key) ?? "").split(",").filter(Boolean)) {
      const n = Number(item);
      if (!Number.isInteger(n) || n === 0 || Math.abs(n) > max || n < min) return null;
      list.push(n);
    }
    return list;
  };
  const byMonthDay = numbers("BYMONTHDAY", -31, 31);
  const byMonth = numbers("BYMONTH", 1, 12);
  if (!byMonthDay || !byMonth) return null;
  const weekStart = WEEKDAYS[(parts.get("WKST") ?? "MO").toUpperCase()] ?? 1;
  return { freq, interval, count, until, byDay, byMonthDay, byMonth, weekStart };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Every VEVENT of the calendars in the text; broken ones are left out. */
export function parseIcs(text: string): IcsEvent[] {
  if (typeof text !== "string" || !text) return [];
  const events: IcsEvent[] = [];
  const stack: string[] = [];
  let props: Property[] | null = null;

  for (const line of unfold(text)) {
    if (!line.trim()) continue;
    const property = parseProperty(line);
    if (!property) continue;
    if (property.name === "BEGIN") {
      const component = property.value.toUpperCase();
      stack.push(component);
      if (component === "VEVENT" && stack.includes("VCALENDAR") && stack.length === 2) props = [];
      continue;
    }
    if (property.name === "END") {
      const component = property.value.toUpperCase();
      const index = stack.lastIndexOf(component);
      if (index >= 0) stack.length = index;
      if (component === "VEVENT" && props) {
        const event = toEvent(props);
        if (event) events.push(event);
        props = null;
      }
      continue;
    }
    // Only the event's own lines, not those of an alarm inside it.
    if (props && stack[stack.length - 1] === "VEVENT") props.push(property);
  }
  return events;
}

function toEvent(props: Property[]): IcsEvent | null {
  try {
    const first = (name: string) => props.find((p) => p.name === name);
    const startProp = first("DTSTART");
    if (!startProp) return null;
    const start = parseTime(startProp.value, startProp.params);
    if (!start) return null;
    const endProp = first("DTEND");
    const end = endProp ? parseTime(endProp.value, endProp.params) : null;
    const durationProp = first("DURATION");
    const duration = !end && durationProp ? parseDuration(durationProp.value) : null;
    const ruleProp = first("RRULE");
    const rule = ruleProp ? parseRule(ruleProp.value) : null;
    const exdates = props
      .filter((p) => p.name === "EXDATE")
      .flatMap((p) => parseTimeList(p.value, p.params));
    const rdates = props
      .filter((p) => p.name === "RDATE" && p.params.VALUE !== "PERIOD")
      .flatMap((p) => parseTimeList(p.value, p.params));
    const recurrenceProp = first("RECURRENCE-ID");
    const recurrenceId = recurrenceProp
      ? parseTime(recurrenceProp.value, recurrenceProp.params)
      : null;
    return {
      uid: first("UID")?.value || null,
      start,
      end,
      duration,
      rule,
      exdates,
      rdates,
      recurrenceId,
      cancelled: first("STATUS")?.value.toUpperCase() === "CANCELLED",
      transparent: first("TRANSP")?.value.toUpperCase() === "TRANSPARENT",
      allDay: start.kind === "date",
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Expanding into busy intervals
// ---------------------------------------------------------------------------

export type BusyOptions = {
  /** Window in UTC milliseconds; only what falls inside is kept. */
  from: number;
  to: number;
  /** For floating times, unknown zones and all-day events (the person's own zone). */
  defaultTimeZone: string;
  maxIntervals?: number;
  /** Safety: occurrences of one event kept inside the window. */
  maxOccurrences?: number;
};

/** Hard stop for walking a rule period by period (COUNT rules walk from the start). */
const MAX_PERIODS = 20_000;
const DAY_MS = 86_400_000;

type Occurrence = { start: number; end: number; allDay: boolean };

/** One occurrence as UTC milliseconds; `key` matches EXDATE and RECURRENCE-ID. */
function instantOfTime(time: IcsTime, zone: string): number {
  if (time.kind === "utc") return time.ms;
  if (time.kind === "date") return startOfDay(time.day, zone);
  return instantOf(time.wall, time.tz ?? zone);
}

function dayOfTime(time: IcsTime, zone: string): Day {
  if (time.kind === "date") return time.day;
  if (time.kind === "local") return dayOf(time.wall);
  return dayOf(wallOf(time.ms, zone));
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Days of a month matching the BYDAY entries (with nth relative to the month). */
function monthWeekdays(year: number, month: number, byDay: IcsRule["byDay"]): number[] {
  const last = lastDayOfMonth(year, month);
  const out = new Set<number>();
  for (const { weekday, nth } of byDay) {
    const days: number[] = [];
    for (let d = 1; d <= last; d++) {
      if (weekdayOf(dayOf({ year, month, day: d })) === weekday) days.push(d);
    }
    if (nth === 0) days.forEach((d) => out.add(d));
    else {
      const pick = nth > 0 ? days[nth - 1] : days[days.length + nth];
      if (pick !== undefined) out.add(pick);
    }
  }
  return [...out];
}

/** Days of a year (as day strings) matching BYDAY with nth relative to the year. */
function yearWeekdays(year: number, byDay: IcsRule["byDay"]): Day[] {
  const out = new Set<Day>();
  const first = dayOf({ year, month: 1, day: 1 });
  const total = daysBetween(first, dayOf({ year: year + 1, month: 1, day: 1 }));
  for (const { weekday, nth } of byDay) {
    const days: Day[] = [];
    for (let i = 0; i < total; i++) {
      const day = addDays(first, i);
      if (weekdayOf(day) === weekday) days.push(day);
    }
    if (nth === 0) days.forEach((d) => out.add(d));
    else {
      const pick = nth > 0 ? days[nth - 1] : days[days.length + nth];
      if (pick) out.add(pick);
    }
  }
  return [...out];
}

function monthDays(year: number, month: number, byMonthDay: number[]): number[] {
  const last = lastDayOfMonth(year, month);
  return byMonthDay.map((n) => (n > 0 ? n : last + 1 + n)).filter((d) => d >= 1 && d <= last);
}

/** The candidate days of one period of the rule, sorted. */
function periodDays(rule: IcsRule, startDay: Day, period: number): Day[] {
  const start = parseDay(startDay);
  const plainWeekdays = rule.byDay.filter((d) => d.nth === 0).map((d) => d.weekday);
  let days: Day[] = [];
  if (rule.freq === "DAILY") {
    const day = addDays(startDay, period * rule.interval);
    days = [day];
    const p = parseDay(day);
    if (rule.byMonthDay.length && !monthDays(p.year, p.month, rule.byMonthDay).includes(p.day)) {
      days = [];
    }
    if (rule.byDay.length && !plainWeekdays.includes(weekdayOf(day))) days = [];
  } else if (rule.freq === "WEEKLY") {
    const offset = (weekdayOf(startDay) - rule.weekStart + 7) % 7;
    const weekFirst = addDays(startDay, -offset + period * 7 * rule.interval);
    const weekdays = rule.byDay.length ? plainWeekdays : [weekdayOf(startDay)];
    for (let i = 0; i < 7; i++) {
      const day = addDays(weekFirst, i);
      if (weekdays.includes(weekdayOf(day))) days.push(day);
    }
  } else if (rule.freq === "MONTHLY") {
    const index = start.year * 12 + (start.month - 1) + period * rule.interval;
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    let list: number[];
    if (rule.byMonthDay.length && rule.byDay.length) {
      const weekdays = monthWeekdays(year, month, rule.byDay);
      list = monthDays(year, month, rule.byMonthDay).filter((d) => weekdays.includes(d));
    } else if (rule.byMonthDay.length) list = monthDays(year, month, rule.byMonthDay);
    else if (rule.byDay.length) list = monthWeekdays(year, month, rule.byDay);
    else list = start.day <= lastDayOfMonth(year, month) ? [start.day] : [];
    days = list.map((day) => dayOf({ year, month, day }));
  } else {
    const year = start.year + period * rule.interval;
    const months = rule.byMonth.length ? rule.byMonth : [start.month];
    if (rule.byDay.length && !rule.byMonth.length && !rule.byMonthDay.length) {
      days = yearWeekdays(year, rule.byDay);
    } else {
      for (const month of months) {
        let list: number[];
        if (rule.byMonthDay.length && rule.byDay.length) {
          const weekdays = monthWeekdays(year, month, rule.byDay);
          list = monthDays(year, month, rule.byMonthDay).filter((d) => weekdays.includes(d));
        } else if (rule.byMonthDay.length) list = monthDays(year, month, rule.byMonthDay);
        else if (rule.byDay.length) list = monthWeekdays(year, month, rule.byDay);
        else list = start.day <= lastDayOfMonth(year, month) ? [start.day] : [];
        days.push(...list.map((day) => dayOf({ year, month, day })));
      }
    }
  }
  if (rule.byMonth.length && rule.freq !== "YEARLY") {
    days = days.filter((day) => rule.byMonth.includes(parseDay(day).month));
  }
  return [...new Set(days)].sort();
}

/** Periods that can be skipped without reaching the window (only without COUNT). */
function skipPeriods(rule: IcsRule, startDay: Day, fromDay: Day, spanDays: number): number {
  if (rule.count !== null) return 0;
  const gap = daysBetween(startDay, fromDay) - spanDays - 1;
  if (gap <= 0) return 0;
  const start = parseDay(startDay);
  const from = parseDay(fromDay);
  let periods: number;
  if (rule.freq === "DAILY") periods = gap / rule.interval;
  else if (rule.freq === "WEEKLY") periods = gap / (7 * rule.interval);
  else if (rule.freq === "MONTHLY") {
    periods =
      ((from.year - start.year) * 12 + (from.month - start.month) - 1 - Math.ceil(spanDays / 28)) /
      rule.interval;
  } else periods = (from.year - start.year - 1 - Math.ceil(spanDays / 365)) / rule.interval;
  return Math.max(0, Math.floor(periods) - 1);
}

function eventSpan(
  event: IcsEvent,
  zone: string,
): { allDay: boolean; days: number; ms: number } | null {
  if (event.allDay) {
    if (event.end) {
      const days = daysBetween(dayOfTime(event.start, zone), dayOfTime(event.end, zone));
      return { allDay: true, days: Math.max(1, days), ms: 0 };
    }
    if (event.duration) return { allDay: true, days: Math.max(1, event.duration.days), ms: 0 };
    return { allDay: true, days: 1, ms: 0 };
  }
  const startMs = instantOfTime(event.start, zone);
  if (event.end) {
    const ms = instantOfTime(event.end, zone) - startMs;
    return ms > 0 ? { allDay: false, days: 0, ms } : null;
  }
  if (event.duration) {
    const ms = event.duration.days * DAY_MS + event.duration.ms;
    return ms > 0 ? { allDay: false, days: 0, ms } : null;
  }
  return null;
}

/** The zone an event's occurrences are counted in (their wall clock). */
function eventZone(event: IcsEvent, zone: string): string {
  if (event.start.kind === "utc") return "UTC";
  if (event.start.kind === "local") return event.start.tz ?? zone;
  return zone;
}

/** Start instants (or days) of every occurrence of a master event up to `to`. */
function occurrenceStarts(
  event: IcsEvent,
  zone: string,
  options: { from: number; to: number; maxOccurrences: number; spanMs: number; spanDays: number },
): { key: string; start: number }[] {
  const evZone = eventZone(event, zone);
  const startDay = dayOfTime(event.start, evZone);
  const startMs = instantOfTime(event.start, zone);
  const wall =
    event.start.kind === "local"
      ? event.start.wall
      : event.start.kind === "utc"
        ? wallOf(event.start.ms, "UTC")
        : null;
  const at = (day: Day) => {
    if (!wall) return startOfDay(day, zone);
    const p = parseDay(day);
    return instantOf({ ...p, hour: wall.hour, minute: wall.minute }, evZone);
  };
  const keyOf = (start: number, day: Day) => (event.allDay ? `d:${day}` : `t:${start}`);

  const out: { key: string; start: number }[] = [];
  const rule = event.rule;
  if (!rule) {
    out.push({ key: keyOf(startMs, startDay), start: startMs });
  } else {
    const until: { day: Day } | { ms: number } | null =
      rule.until === null
        ? null
        : rule.until.kind === "date"
          ? { day: rule.until.day }
          : { ms: instantOfTime(rule.until, evZone) };
    const fromDay = dayOf(wallOf(options.from, evZone));
    let emitted = 0;
    let kept = 0;
    let done = false;
    for (
      let period = skipPeriods(rule, startDay, fromDay, options.spanDays + 1);
      period < MAX_PERIODS && !done;
      period++
    ) {
      const days = periodDays(rule, startDay, period);
      if (!days.length) {
        // A period past the window ends the walk even if it had no day.
        if (period > 0 && periodStartAfter(rule, startDay, period, options.to, zone)) break;
        continue;
      }
      for (const day of days) {
        if (day < startDay) continue;
        const start = at(day);
        if (start < startMs) continue;
        if (until && ("day" in until ? day > until.day : start > until.ms)) {
          done = true;
          break;
        }
        if (start >= options.to) {
          done = true;
          break;
        }
        emitted += 1;
        if (start + options.spanMs > options.from) {
          out.push({ key: keyOf(start, day), start });
          kept += 1;
        }
        if ((rule.count !== null && emitted >= rule.count) || kept >= options.maxOccurrences) {
          done = true;
          break;
        }
      }
    }
  }
  for (const rdate of event.rdates) {
    const day = dayOfTime(rdate, evZone);
    const start = rdate.kind === "date" && wall ? at(day) : instantOfTime(rdate, zone);
    out.push({ key: keyOf(start, day), start });
  }
  const excluded = new Set(
    event.exdates.map((time) => {
      if (event.allDay || time.kind === "date") return `d:${dayOfTime(time, evZone)}`;
      return `t:${instantOfTime(time, zone)}`;
    }),
  );
  const seen = new Set<string>();
  return out.filter((item) => {
    const day = event.allDay ? item.key : `d:${dayOf(wallOf(item.start, evZone))}`;
    if (excluded.has(item.key) || excluded.has(day) || seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}

function periodStartAfter(rule: IcsRule, startDay: Day, period: number, to: number, zone: string) {
  const start = parseDay(startDay);
  let first: Day;
  if (rule.freq === "DAILY") first = addDays(startDay, period * rule.interval);
  else if (rule.freq === "WEEKLY") first = addDays(startDay, period * 7 * rule.interval - 7);
  else if (rule.freq === "MONTHLY") {
    const index = start.year * 12 + (start.month - 1) + period * rule.interval;
    first = dayOf({ year: Math.floor(index / 12), month: (index % 12) + 1, day: 1 });
  } else first = dayOf({ year: start.year + period * rule.interval, month: 1, day: 1 });
  return startOfDay(first, zone) >= to;
}

function recurrenceKey(event: IcsEvent, master: IcsEvent | undefined, zone: string): string[] {
  const id = event.recurrenceId!;
  const evZone = master ? eventZone(master, zone) : eventZone(event, zone);
  if (id.kind === "date" || master?.allDay) return [`d:${dayOfTime(id, evZone)}`];
  return [`t:${instantOfTime(id, zone)}`];
}

/** The busy intervals of a calendar inside the window, sorted and merged. */
export function icsBusy(text: string, options: BusyOptions): BusyInterval[] {
  const { from, to, defaultTimeZone } = options;
  if (!(to > from)) return [];
  const zone = isValidTimeZone(defaultTimeZone) ? defaultTimeZone : "UTC";
  const maxIntervals = options.maxIntervals ?? 2000;
  const maxOccurrences = options.maxOccurrences ?? 1000;
  let events: IcsEvent[];
  try {
    events = parseIcs(text);
  } catch {
    return [];
  }

  const masters = new Map<string, IcsEvent>();
  for (const event of events) {
    if (!event.recurrenceId && event.uid) masters.set(event.uid, event);
  }
  // Moved or cancelled single occurrences, by the series they belong to.
  const replaced = new Map<string, Set<string>>();
  for (const event of events) {
    if (!event.recurrenceId || !event.uid) continue;
    const set = replaced.get(event.uid) ?? new Set<string>();
    recurrenceKey(event, masters.get(event.uid), zone).forEach((key) => set.add(key));
    replaced.set(event.uid, set);
  }

  const occurrences: Occurrence[] = [];
  for (const event of events) {
    try {
      if (event.cancelled || event.transparent) continue;
      const span = eventSpan(event, zone);
      if (!span) continue;
      const spanMs = span.allDay ? span.days * DAY_MS + DAY_MS : span.ms;
      const starts = event.recurrenceId
        ? [{ key: "", start: instantOfTime(event.start, zone) }]
        : occurrenceStarts(event, zone, {
            from,
            to,
            maxOccurrences,
            spanMs,
            spanDays: span.allDay ? span.days : Math.ceil(span.ms / DAY_MS),
          });
      const skip = !event.recurrenceId && event.uid ? replaced.get(event.uid) : undefined;
      for (const { key, start } of starts) {
        if (skip?.has(key)) continue;
        if (span.allDay) {
          const day = event.recurrenceId
            ? dayOfTime(event.start, zone)
            : dayOf(wallOf(start, zone));
          occurrences.push({
            start: startOfDay(day, zone),
            end: startOfDay(addDays(day, span.days), zone),
            allDay: true,
          });
        } else {
          occurrences.push({ start, end: start + span.ms, allDay: false });
        }
      }
    } catch {
      // A broken event is left out.
    }
  }

  const clipped = occurrences
    .map((o) => ({ ...o, start: Math.max(o.start, from), end: Math.min(o.end, to) }))
    .filter((o) => o.end > o.start);

  const merged: Occurrence[] = [];
  for (const allDay of [false, true]) {
    const list = clipped.filter((o) => o.allDay === allDay).sort((a, b) => a.start - b.start);
    const kind: Occurrence[] = [];
    for (const item of list) {
      const last = kind[kind.length - 1];
      if (last && item.start <= last.end) last.end = Math.max(last.end, item.end);
      else kind.push({ ...item });
    }
    merged.push(...kind);
  }
  merged.sort((a, b) => a.start - b.start || Number(b.allDay) - Number(a.allDay));
  return merged.slice(0, maxIntervals).map((o) => {
    const interval: BusyInterval = {
      start: new Date(o.start).toISOString(),
      end: new Date(o.end).toISOString(),
    };
    if (o.allDay) interval.allDay = true;
    return interval;
  });
}
