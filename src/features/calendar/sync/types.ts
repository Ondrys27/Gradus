import { addDays, dayIn, startOfDay, type Day } from "@/features/scheduler/zoned";

/**
 * Two-way calendar sync (28.10): what every provider (Google, Apple, later
 * Outlook) speaks, so the engine (engine.ts) never knows which one it talks
 * to. Times are ISO instants; all-day events follow Gradus's convention:
 * `startsAt` = midnight of the first day in the person's zone, `endsAt` =
 * midnight of the last day, or null for a single day. Providers translate
 * from and to their own shapes (an exclusive end date, DTEND;VALUE=DATE).
 */

export const PROVIDERS = ["google", "apple"] as const;
export type ProviderKey = (typeof PROVIDERS)[number];

export function isProviderKey(value: unknown): value is ProviderKey {
  return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}

/** A calendar of the account at the provider. */
export type RemoteCalendar = {
  externalId: string;
  name: string;
  isPrimary: boolean;
  canWrite: boolean;
};

/** One event (or one instance of a series) as the provider has it. */
export type RemoteEvent = {
  /** The instance's id: Google's event id, the CalDAV address + "#" + recurrence. */
  externalId: string;
  /** The series an instance belongs to, null for a single event. */
  recurringId: string | null;
  etag: string | null;
  /** The provider's last change (ISO), for "the newer change wins". */
  updatedAt: string | null;
  /** Deleted (Google's status "cancelled"). */
  cancelled: boolean;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  /** "Free": shown, never busy. */
  transparent: boolean;
};

/** A Gradus event to write out. */
export type OutgoingEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  /** The person's zone (all-day days, a series' wall clock). */
  timeZone: string;
  /** A booked meeting's guest, invited by the provider (Google). */
  attendees?: { email: string; name?: string | null }[];
  /** Ask the provider for a video conference (Google Meet), with this request id. */
  conference?: { requestId: string } | null;
};

/** The link a Gradus event has to a provider's event. */
export type LinkTarget = {
  externalId: string;
  etag: string | null;
  recurringId: string | null;
};

export type SyncWindow = { from: number; to: number };

export type PullResult = {
  /** A full read (first time, or the provider forgot its state): what is not here is gone. */
  full: boolean;
  /** Changed or new events, deleted ones with `cancelled`. */
  events: RemoteEvent[];
  /** Whole series that are gone. */
  removedSeries: string[];
  /** Ids gone (a provider that tells only what is left, like CalDAV, lists them here). */
  removed: string[];
  /**
   * Series whose instances in `events` are all there are in the window (a
   * CalDAV resource read again): other instances of them are gone.
   */
  completeSeries: string[];
  /** The provider's state for next time (Google's syncToken, a ctag + etags). Null = read all again. */
  state: string | null;
};

export type PutResult =
  | { ok: true; event: RemoteEvent; meetLink: string | null }
  /** The other side changed since the etag we hold; `remote` is how it is now (null = deleted). */
  | { ok: false; reason: "conflict"; remote: RemoteEvent | null }
  /** The target is gone; write it as a new event. */
  | { ok: false; reason: "gone" };

/** Every provider: the same few calls. Errors are thrown as `ProviderError`. */
export interface CalendarProvider {
  readonly key: ProviderKey;
  listCalendars(): Promise<RemoteCalendar[]>;
  /**
   * What changed since `state`. `known` = the etag held per series (CalDAV
   * resource), so a provider that cannot list changes reads only what differs.
   */
  pull(
    calendarId: string,
    state: string | null,
    window: SyncWindow,
    known?: ReadonlyMap<string, string>,
  ): Promise<PullResult>;
  getEvent(calendarId: string, externalId: string): Promise<RemoteEvent | null>;
  putEvent(calendarId: string, event: OutgoingEvent, target: LinkTarget | null): Promise<PutResult>;
  deleteEvent(calendarId: string, target: LinkTarget): Promise<void>;
}

export type ProviderErrorCode =
  /** The account took the access back, the password changed: connect again. */
  | "auth"
  /** The account may not do this (a read-only calendar). */
  | "forbidden"
  | "notFound"
  | "rateLimited"
  | "network"
  | "invalid"
  | "unknown";

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    readonly status: number | null = null,
  ) {
    super(`calendar provider: ${code}${status ? ` (${status})` : ""}`);
    this.name = "ProviderError";
  }
}

/** The status of an HTTP answer as one of our codes. */
export function codeOfStatus(status: number): ProviderErrorCode {
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404 || status === 410) return "notFound";
  if (status === 429) return "rateLimited";
  if (status === 400 || status === 422) return "invalid";
  if (status >= 500) return "network";
  return "unknown";
}

/** `fetch` as the providers use it, injected so tests answer with a mock server. */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------
// All-day events: Gradus's convention <-> an exclusive end day
// ---------------------------------------------------------------------------

/** First day and the day after the last (exclusive), as most calendars store them. */
export function allDayDays(
  startsAt: string,
  endsAt: string | null,
  timeZone: string,
): { start: Day; endExclusive: Day } {
  const start = dayIn(Date.parse(startsAt), timeZone);
  const last = endsAt ? dayIn(Date.parse(endsAt), timeZone) : start;
  return { start, endExclusive: addDays(last < start ? start : last, 1) };
}

/** The other way: Gradus's start and end of an all-day event from its days. */
export function allDayInstants(
  start: Day,
  endExclusive: Day | null,
  timeZone: string,
): { startsAt: string; endsAt: string | null } {
  const last = endExclusive ? addDays(endExclusive, -1) : start;
  return {
    startsAt: new Date(startOfDay(start, timeZone)).toISOString(),
    endsAt: last > start ? new Date(startOfDay(last, timeZone)).toISOString() : null,
  };
}
