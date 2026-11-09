import {
  addDays,
  dayIn,
  instantAtMinute,
  minutesOfTime,
  wallExists,
  wallOf,
  weekdayOf,
  parseDay,
  timeOfMinutes,
  type Day,
} from "./zoned";

/**
 * The free times of a meeting type (24.3), as one pure function shared by the
 * host's preview and the public booking page (24.4):
 *
 *   working hours of the rules in the host's zone
 *   → minus the exceptions (a date with other hours, or blocked)
 *   → minus what is busy: the host's own Gradus events and timed tasks, the
 *     busy times of subscribed calendars, active bookings and unexpired holds
 *     (each padded by the type's buffer before and after)
 *   → minimum notice, how far ahead, the day's maximum of this type
 *   → slots every `slotStepMin` minutes of the host's wall clock
 *   → read in the guest's zone (slotsByGuestDay).
 *
 * Instants are UTC milliseconds; days and clock times are the host's wall
 * clock, never the machine's, so DST changes and midnight behave.
 */

export type Interval = { start: number; end: number };

/** One interval of the weekly hours; times `HH:mm` (or `HH:mm:ss`), end 24:00 = midnight. */
export type SlotRule = { weekday: number; start_time: string; end_time: string };

/** A date with other hours, or blocked as a whole (both times null). */
export type SlotOverride = { date: Day; start_time: string | null; end_time: string | null };

export type SlotType = {
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  maxPerDay: number | null;
  slotStepMin: number;
};

/** An active booking of the host; `sameType` ones count toward the day's maximum. */
export type BookingBusy = Interval & { sameType: boolean };

export type SlotInput = {
  hostTimeZone: string;
  rules: readonly SlotRule[];
  overrides: readonly SlotOverride[];
  /** Everything else that blocks the host: events, timed tasks, subscribed calendars. */
  busy: readonly Interval[];
  bookings: readonly BookingBusy[];
  type: SlotType;
  now: number;
  /** Host days to compute, both inclusive; default today … today + maxDaysAhead. */
  from?: Day;
  to?: Day;
};

export type Slot = { start: number; end: number; hostDay: Day };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** A hard stop, whatever the input asks for. */
const MAX_DAYS = 62;

/** Sorted, overlapping and touching intervals joined; empty ones dropped. */
export function mergeIntervals(list: readonly Interval[]): Interval[] {
  const sorted = list
    .filter(
      (item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start,
    )
    .map((item) => ({ start: item.start, end: item.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const item of sorted) {
    const last = out[out.length - 1];
    if (last && item.start <= last.end) last.end = Math.max(last.end, item.end);
    else out.push(item);
  }
  return out;
}

/** The clock intervals of one host day: its exceptions if it has any, else the week's rules. */
export function dayIntervals(
  day: Day,
  rules: readonly SlotRule[],
  overrides: readonly SlotOverride[],
): Array<{ from: number; to: number }> {
  const exceptions = overrides.filter((override) => override.date === day);
  const source = exceptions.length
    ? exceptions.some((override) => override.start_time === null || override.end_time === null)
      ? []
      : exceptions.map((override) => ({ start: override.start_time!, end: override.end_time! }))
    : rules
        .filter((rule) => rule.weekday === weekdayOf(day))
        .map((rule) => ({ start: rule.start_time, end: rule.end_time }));
  return source
    .map((item) => ({ from: minutesOfTime(item.start), to: minutesOfTime(item.end) }))
    .filter(
      (item) => Number.isFinite(item.from) && Number.isFinite(item.to) && item.to > item.from,
    );
}

/** The working hours of the host days `from`…`to` as merged instants (midnight joins two days). */
export function availabilityIntervals(
  rules: readonly SlotRule[],
  overrides: readonly SlotOverride[],
  from: Day,
  to: Day,
  timeZone: string,
): Interval[] {
  const out: Interval[] = [];
  for (
    let day = from, guard = 0;
    day <= to && guard < MAX_DAYS + 2;
    day = addDays(day, 1), guard++
  ) {
    for (const { from: start, to: end } of dayIntervals(day, rules, overrides)) {
      out.push({
        start: instantAtMinute(day, start, timeZone),
        end: instantAtMinute(day, end, timeZone),
      });
    }
  }
  return mergeIntervals(out);
}

/** Index of the first interval whose end is after `at` (intervals sorted and merged). */
function firstEndingAfter(list: readonly Interval[], at: number): number {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (list[mid].end > at) high = mid;
    else low = mid + 1;
  }
  return low;
}

function inside(list: readonly Interval[], start: number, end: number): boolean {
  const index = firstEndingAfter(list, start);
  const found = list[index];
  return Boolean(found && found.start <= start && found.end >= end);
}

function overlaps(list: readonly Interval[], start: number, end: number): boolean {
  const index = firstEndingAfter(list, start);
  const found = list[index];
  return Boolean(found && found.start < end);
}

export function computeSlots(input: SlotInput): Slot[] {
  const { hostTimeZone: zone, type, now } = input;
  const duration = Math.max(1, Math.round(type.durationMin)) * MINUTE;
  const step = Math.max(5, Math.round(type.slotStepMin));
  const today = dayIn(now, zone);
  const horizon = Math.min(Math.max(0, Math.round(type.maxDaysAhead)), MAX_DAYS);
  const lastAllowed = addDays(today, horizon);
  const from = input.from && input.from > today ? input.from : today;
  const wanted = input.to && input.to < lastAllowed ? input.to : lastAllowed;
  if (from > wanted) return [];
  const earliest = now + Math.max(0, type.minNoticeHours) * HOUR;

  // A slot running past midnight of the last day still needs the next day's hours.
  const available = availabilityIntervals(
    input.rules,
    input.overrides,
    from,
    addDays(wanted, 1),
    zone,
  );
  if (!available.length) return [];

  // Padding the busy times by the buffers: a slot [s, e] is blocked when
  // [s − before, e + after] touches something busy.
  const before = Math.max(0, type.bufferBeforeMin) * MINUTE;
  const after = Math.max(0, type.bufferAfterMin) * MINUTE;
  const blocked = mergeIntervals(
    [...input.busy, ...input.bookings].map((item) => ({
      start: item.start - after,
      end: item.end + before,
    })),
  );

  const perDay = new Map<Day, number>();
  if (type.maxPerDay !== null) {
    for (const booking of input.bookings) {
      if (!booking.sameType) continue;
      const day = dayIn(booking.start, zone);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
  }

  const slots: Slot[] = [];
  const seen = new Set<number>();
  for (
    let day = from, guard = 0;
    day <= wanted && guard < MAX_DAYS + 1;
    day = addDays(day, 1), guard++
  ) {
    if (type.maxPerDay !== null && (perDay.get(day) ?? 0) >= type.maxPerDay) continue;
    const { year, month, day: date } = parseDay(day);
    for (let minute = 0; minute < 1440; minute += step) {
      const wall = { year, month, day: date, hour: Math.floor(minute / 60), minute: minute % 60 };
      // A clock time skipped by a DST jump has no slot.
      if (!wallExists(wall, zone)) continue;
      const start = instantAtMinute(day, minute, zone);
      if (seen.has(start)) continue;
      const end = start + duration;
      if (start < earliest) continue;
      if (!inside(available, start, end)) continue;
      if (overlaps(blocked, start, end)) continue;
      seen.add(start);
      slots.push({ start, end, hostDay: day });
    }
  }
  return slots.sort((a, b) => a.start - b.start);
}

export type GuestSlot = { start: number; end: number; time: string };
export type GuestDay = { day: Day; slots: GuestSlot[] };

/** The slots by the guest's calendar day, each with its clock time in the guest's zone. */
export function slotsByGuestDay(slots: readonly Slot[], guestTimeZone: string): GuestDay[] {
  const days = new Map<Day, GuestSlot[]>();
  for (const slot of [...slots].sort((a, b) => a.start - b.start)) {
    const wall = wallOf(slot.start, guestTimeZone);
    const day = dayIn(slot.start, guestTimeZone);
    const list = days.get(day) ?? [];
    list.push({
      start: slot.start,
      end: slot.end,
      time: timeOfMinutes(wall.hour * 60 + wall.minute),
    });
    days.set(day, list);
  }
  return [...days.entries()].map(([day, list]) => ({ day, slots: list }));
}

/** Bookings that still hold the host's time: pending and confirmed, and holds until they expire. */
export function activeBookings<
  T extends { status: string; starts_at: string; ends_at: string; hold_expires_at: string | null },
>(bookings: readonly T[], now: number): T[] {
  return bookings.filter((booking) => {
    if (booking.status === "pending" || booking.status === "confirmed") return true;
    if (booking.status !== "held") return false;
    return booking.hold_expires_at !== null && Date.parse(booking.hold_expires_at) > now;
  });
}

/** The rules a type uses: its own when it has its own hours, else the profile's. */
export function rulesFor<T extends SlotRule & { event_type_id: string | null }>(
  rules: readonly T[],
  type: { id: string; custom_availability: boolean },
): T[] {
  return type.custom_availability
    ? rules.filter((rule) => rule.event_type_id === type.id)
    : rules.filter((rule) => rule.event_type_id === null);
}
