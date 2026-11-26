/**
 * Where the scheduler reads busy times and where it writes a new booking
 * (30.4), independent of what the Calendar section shows. Stored as JSON on
 * the profile (`scheduler_profiles.calendar_sources`) and, to override it,
 * on one meeting type (`event_types.calendar_sources`, null = the profile's):
 *
 *   { gradus: boolean,            the Gradus calendar (events, timed tasks)
 *     calendars: string[],        connected Google / Apple calendars by id
 *     subscriptions: string[],    subscribed ICS calendars by id
 *     write?: string | null }     a connected calendar new bookings go to;
 *                                 null = Gradus only, missing = the calendar
 *                                 the person writes to in Settings → Calendar
 *
 * A profile with null (made before 30.4) keeps everything busy: Gradus,
 * every calendar it reads and every subscription. New profiles start with
 * only Gradus. Bookings and holds always count, whatever is chosen, and a
 * booking always lands in the Gradus calendar too.
 *
 * `validCalendarSources` is `scheduler_calendar_sources_valid()` in the
 * database (a Vitest compares them on samples).
 */

export type CalendarSources = {
  gradus: boolean;
  calendars: string[];
  subscriptions: string[];
  /** Missing = follow Settings → Calendar; null = Gradus only. */
  write?: string | null;
};

export const MAX_SOURCE_CALENDARS = 200;
export const MAX_SOURCE_SUBSCRIPTIONS = 20;

/** What a new profile starts with. */
export const DEFAULT_SOURCES: CalendarSources = { gradus: true, calendars: [], subscriptions: [] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEYS = new Set(["gradus", "calendars", "subscriptions", "write"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function idList(value: unknown, max: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= max &&
    value.every((item) => typeof item === "string" && UUID.test(item))
  );
}

/** Strict, as the database checks it; null is valid (legacy / the profile's). */
export function validCalendarSources(value: unknown): value is CalendarSources | null {
  if (value === null) return true;
  if (!isObject(value)) return false;
  if (Object.keys(value).some((key) => !KEYS.has(key))) return false;
  if (typeof value.gradus !== "boolean") return false;
  if (!idList(value.calendars, MAX_SOURCE_CALENDARS)) return false;
  if (!idList(value.subscriptions, MAX_SOURCE_SUBSCRIPTIONS)) return false;
  if ("write" in value) {
    const write = value.write;
    if (write !== null && (typeof write !== "string" || !UUID.test(write))) return false;
  }
  return true;
}

/** A stored value as the app uses it; anything broken counts as not set (null). */
export function parseCalendarSources(value: unknown): CalendarSources | null {
  if (value === null || value === undefined || !validCalendarSources(value)) return null;
  const sources = value as CalendarSources;
  return {
    gradus: sources.gradus,
    calendars: [...new Set(sources.calendars)],
    subscriptions: [...new Set(sources.subscriptions)],
    ...("write" in sources ? { write: sources.write ?? null } : {}),
  };
}

/** What the person has to choose from. */
export type AvailableSources = {
  /** Connected calendars (any, read or not), and whether they can be written. */
  calendars: Array<{ id: string; canWrite: boolean; read: boolean; write: boolean }>;
  subscriptions: Array<{ id: string }>;
};

/** The effective choice: what counts as busy and where bookings go. */
export type ResolvedSources = {
  gradus: boolean;
  calendars: string[];
  subscriptions: string[];
  /** The connected calendar a new booking is written to, or null (Gradus only). */
  write: string | null;
};

/**
 * The sources in force for a type: its own when it has them, else the
 * profile's; a profile without any (before 30.4) reads everything it did
 * then. Only sources the person still has count.
 */
export function resolveSources(
  profile: unknown,
  type: unknown,
  available: AvailableSources,
): ResolvedSources {
  const own = parseCalendarSources(type) ?? parseCalendarSources(profile);
  const calendarIds = new Set(available.calendars.map((calendar) => calendar.id));
  const subscriptionIds = new Set(available.subscriptions.map((item) => item.id));
  const generalWrite =
    available.calendars.find((calendar) => calendar.write && calendar.canWrite)?.id ?? null;
  if (!own) {
    return {
      gradus: true,
      calendars: available.calendars
        .filter((calendar) => calendar.read)
        .map((calendar) => calendar.id),
      subscriptions: [...subscriptionIds],
      write: generalWrite,
    };
  }
  const writable = new Set(
    available.calendars.filter((calendar) => calendar.canWrite).map((calendar) => calendar.id),
  );
  const write =
    own.write === undefined
      ? generalWrite
      : own.write && writable.has(own.write)
        ? own.write
        : null;
  return {
    gradus: own.gradus,
    calendars: own.calendars.filter((id) => calendarIds.has(id)),
    subscriptions: own.subscriptions.filter((id) => subscriptionIds.has(id)),
    write,
  };
}

/** The form's value of a choice, as it is stored (always explicit). */
export function toStored(resolved: ResolvedSources): CalendarSources {
  return {
    gradus: resolved.gradus,
    calendars: [...new Set(resolved.calendars)].slice(0, MAX_SOURCE_CALENDARS),
    subscriptions: [...new Set(resolved.subscriptions)].slice(0, MAX_SOURCE_SUBSCRIPTIONS),
    write: resolved.write,
  };
}

/** How many sources are ticked (zero means only bookings block). */
export function sourceCount(
  resolved: Pick<ResolvedSources, "gradus" | "calendars" | "subscriptions">,
) {
  return (resolved.gradus ? 1 : 0) + resolved.calendars.length + resolved.subscriptions.length;
}

/**
 * Where the sync engine writes a booked meeting: a connected calendar, or
 * nowhere but Gradus ("none"), or the person's calendar of Settings →
 * Calendar ("default").
 */
export type BookingWriteTarget =
  { kind: "default" } | { kind: "none" } | { kind: "calendar"; id: string };

export function bookingWriteTarget(profile: unknown, type: unknown): BookingWriteTarget {
  const own = parseCalendarSources(type) ?? parseCalendarSources(profile);
  if (!own || own.write === undefined) return { kind: "default" };
  return own.write ? { kind: "calendar", id: own.write } : { kind: "none" };
}
