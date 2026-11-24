import {
  ProviderError,
  type CalendarProvider,
  type LinkTarget,
  type OutgoingEvent,
  type RemoteEvent,
  type SyncWindow,
} from "./types";

/**
 * Two-way sync (28.10), the same for every provider. The database side is a
 * `SyncStore` (server/store.ts on Supabase, an in-memory one in the tests),
 * the other calendar a `CalendarProvider`.
 *
 * Reading (pullCalendar): what changed in the other calendar since last time
 * comes into Gradus through one call (`apply`, which never echoes back).
 * An event changed on both sides since they last agreed is a conflict: the
 * newer change wins, the other side is overwritten, the link remembers it
 * (shown in the event's detail).
 *
 * Writing (flushOutbox): every change of a person's event waits in the
 * outbox (a trigger puts it there) and goes out right after: a new Gradus
 * event to the calendar the person writes to, an event already linked to its
 * own calendar (one instance of a series by its own id). The etag held makes
 * the other side say when it changed meanwhile; then again the newer wins.
 */

const DAY = 86_400_000;
/** What is mirrored: a month back, a year ahead. */
export const SYNC_PAST_DAYS = 30;
export const SYNC_FUTURE_DAYS = 365;
/** A change that fails this many times is dropped (the next change sends the event again). */
export const OUTBOX_MAX_ATTEMPTS = 5;
/** Rows per call into the database. */
const APPLY_CHUNK = 200;

export function syncWindow(now: number): SyncWindow {
  return { from: now - SYNC_PAST_DAYS * DAY, to: now + SYNC_FUTURE_DAYS * DAY };
}

export type LinkOrigin = "gradus" | "external";
export type ConflictWinner = "gradus" | "external";

export type StoredLink = {
  eventId: string;
  calendarId: string;
  connectionId: string;
  externalId: string;
  recurringId: string | null;
  etag: string | null;
  origin: LinkOrigin;
  /** calendar_events.updated_at when both sides last agreed. */
  syncedAt: string | null;
};

export type LocalEvent = {
  id: string;
  user_id: string;
  actor_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  updated_at: string;
  source: string;
  is_demo: boolean;
};

export type ApplyRow = {
  external_id: string;
  recurring_id: string | null;
  etag: string | null;
  external_updated_at: string | null;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  transparent: boolean;
  conflict: ConflictWinner | null;
};

export type SyncCalendar = {
  /** calendar_connection_calendars.id */
  id: string;
  connectionId: string;
  externalId: string;
  syncState: string | null;
  canWrite: boolean;
};

export type OutboxLink = {
  calendar_id: string;
  connection_id: string;
  external_id: string;
  recurring_id: string | null;
  etag: string | null;
  origin: LinkOrigin;
};

export type OutboxItem = {
  id: number;
  eventId: string;
  op: "upsert" | "delete";
  link: OutboxLink | null;
  attempts: number;
};

/** A booked meeting: the guest is invited, Google may add a Meet call. */
export type BookingInfo = {
  id: string;
  guestEmail: string | null;
  guestName: string | null;
  wantsMeet: boolean;
  meetLink: string | null;
};

export interface SyncStore {
  links(calendarId: string): Promise<StoredLink[]>;
  linkOf(eventId: string): Promise<StoredLink | null>;
  events(ids: string[]): Promise<LocalEvent[]>;
  apply(calendarId: string, rows: ApplyRow[], deletes: string[], deleteSeries: string[]): Promise<void>;
  saveState(calendarId: string, state: string | null): Promise<void>;
  /** A conflict Gradus won: the link takes the other side's etag, so the next write overwrites it. */
  markConflict(eventId: string, etag: string | null, winner: ConflictWinner): Promise<void>;
  saveLink(link: StoredLink & { externalUpdatedAt: string | null }): Promise<void>;
  /** One etag for every instance of a series (a CalDAV resource has one for all of them). */
  setSeriesEtag(calendarId: string, recurringId: string, etag: string | null): Promise<void>;
  calendar(calendarId: string): Promise<SyncCalendar | null>;
  writeCalendar(userId: string): Promise<SyncCalendar | null>;
  claimOutbox(userId: string, limit: number): Promise<OutboxItem[]>;
  doneOutbox(id: number): Promise<void>;
  failOutbox(id: number, code: string, drop: boolean): Promise<void>;
  bookingOf(eventId: string): Promise<BookingInfo | null>;
  setMeetLink(bookingId: string, link: string): Promise<void>;
}

const stamp = (value: string | null | undefined) => (value ? Date.parse(value) : Number.NaN);

/** Whether Gradus changed the event since both sides last agreed. */
export function changedLocally(event: Pick<LocalEvent, "updated_at">, link: Pick<StoredLink, "syncedAt">) {
  const updated = stamp(event.updated_at);
  const synced = stamp(link.syncedAt);
  if (!Number.isFinite(synced)) return true;
  return Number.isFinite(updated) && updated > synced;
}

/**
 * Who wins when both sides changed: the newer change. A remote change
 * without a time loses (we cannot tell it is newer).
 */
export function conflictWinner(localUpdatedAt: string, remoteUpdatedAt: string | null): ConflictWinner {
  const local = stamp(localUpdatedAt);
  const remote = stamp(remoteUpdatedAt);
  if (!Number.isFinite(remote)) return "gradus";
  if (!Number.isFinite(local)) return "external";
  return remote > local ? "external" : "gradus";
}

function overlaps(event: Pick<RemoteEvent, "startsAt" | "endsAt">, window: SyncWindow): boolean {
  const start = Date.parse(event.startsAt);
  const end = event.endsAt ? Date.parse(event.endsAt) : start;
  return start < window.to && Math.max(end, start + 1) > window.from;
}

export function toApplyRow(event: RemoteEvent, conflict: ConflictWinner | null = null): ApplyRow {
  return {
    external_id: event.externalId,
    recurring_id: event.recurringId,
    etag: event.etag,
    external_updated_at: event.updatedAt,
    title: event.title,
    description: event.description,
    location: event.location,
    starts_at: event.startsAt,
    ends_at: event.endsAt,
    all_day: event.allDay,
    transparent: event.transparent,
    conflict,
  };
}

async function applyChunks(
  store: SyncStore,
  calendarId: string,
  rows: ApplyRow[],
  deletes: string[],
  deleteSeries: string[],
) {
  if (!rows.length && !deletes.length && !deleteSeries.length) return;
  for (let index = 0; index < Math.max(rows.length, 1); index += APPLY_CHUNK) {
    const last = index + APPLY_CHUNK >= rows.length;
    // Deletions ride with the last chunk, so a failed run leaves nothing half-gone.
    await store.apply(
      calendarId,
      rows.slice(index, index + APPLY_CHUNK),
      last ? deletes : [],
      last ? deleteSeries : [],
    );
  }
}

export type PullSummary = {
  applied: number;
  deleted: number;
  conflicts: number;
  full: boolean;
};

/** Reads one calendar's changes into Gradus. */
export async function pullCalendar(
  provider: CalendarProvider,
  store: SyncStore,
  calendar: SyncCalendar,
  now = Date.now(),
  options: { full?: boolean } = {},
): Promise<PullSummary> {
  const window = syncWindow(now);
  const links = await store.links(calendar.id);
  const byExternal = new Map(links.map((link) => [link.externalId, link]));
  // The etag held per series (a CalDAV resource): read again only what differs.
  const known = new Map<string, string>();
  for (const link of links) {
    if (link.recurringId && link.etag && !known.has(link.recurringId)) known.set(link.recurringId, link.etag);
  }

  // A full read now and then (daily): series whose new instances slid into the window.
  const result = options.full
    ? await provider.pull(calendar.externalId, null, window)
    : await provider.pull(calendar.externalId, calendar.syncState, window, known);
  const linkedIds = result.events.filter((event) => byExternal.has(event.externalId) && !event.cancelled);
  const locals = new Map(
    (await store.events([...new Set(linkedIds.map((event) => byExternal.get(event.externalId)!.eventId))])).map(
      (event) => [event.id, event],
    ),
  );

  const rows: ApplyRow[] = [];
  const deletes = new Set<string>();
  const deleteSeries = new Set<string>(result.removedSeries);
  const seen = new Set<string>();
  let conflicts = 0;

  for (const event of result.events) {
    seen.add(event.externalId);
    if (event.cancelled) {
      // A deleted event, or a whole deleted series (Google names it by the series' id).
      deletes.add(event.externalId);
      deleteSeries.add(event.externalId);
      continue;
    }
    const link = byExternal.get(event.externalId);
    if (!link) {
      if (overlaps(event, window)) rows.push(toApplyRow(event));
      continue;
    }
    // Unchanged, or our own write coming back.
    if (link.etag && event.etag && link.etag === event.etag) continue;
    const local = locals.get(link.eventId);
    if (local && changedLocally(local, link)) {
      conflicts++;
      if (conflictWinner(local.updated_at, event.updatedAt) === "external") {
        rows.push(toApplyRow(event, "external"));
      } else {
        // Gradus wins: the waiting change goes out over this one.
        await store.markConflict(link.eventId, event.etag, "gradus");
      }
      continue;
    }
    rows.push(toApplyRow(event));
  }
  for (const id of result.removed) deletes.add(id);

  // A series read again whole: its instances not in it are gone.
  if (result.completeSeries.length) {
    const complete = new Set(result.completeSeries);
    for (const link of links) {
      if (link.recurringId && complete.has(link.recurringId) && !seen.has(link.externalId)) {
        deletes.add(link.externalId);
      }
    }
  }
  // A full read: what is not there any more is gone (inside the window it covered).
  if (result.full) {
    const missing = links.filter((link) => !seen.has(link.externalId));
    const starts = new Map(
      (await store.events(missing.map((link) => link.eventId))).map((event) => [event.id, event]),
    );
    for (const link of missing) {
      const event = starts.get(link.eventId);
      if (event && overlaps({ startsAt: event.starts_at, endsAt: event.ends_at }, window)) {
        deletes.add(link.externalId);
      }
    }
  }

  await applyChunks(store, calendar.id, rows, [...deletes], [...deleteSeries]);
  await store.saveState(calendar.id, result.state);
  return { applied: rows.length, deleted: deletes.size, conflicts, full: result.full };
}

// ---------------------------------------------------------------------------
// Writing out
// ---------------------------------------------------------------------------

export type FlushSummary = { sent: number; failed: number; conflicts: number };

export type ProviderResolver = (connectionId: string) => Promise<CalendarProvider | null>;

function outgoing(event: LocalEvent, timeZone: string, booking: BookingInfo | null, isNew: boolean): OutgoingEvent {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    location: event.location,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    allDay: event.all_day,
    timeZone,
    attendees: booking?.guestEmail ? [{ email: booking.guestEmail, name: booking.guestName }] : undefined,
    // A conference only once, when the meeting is first written.
    conference: booking?.wantsMeet && isNew && !booking.meetLink ? { requestId: `gradus-${booking.id}` } : null,
  };
}

function codeOf(error: unknown): string {
  return error instanceof ProviderError ? error.code : "unknown";
}

/** Sends a person's waiting changes; one failure never stops the rest. */
export async function flushOutbox(
  userId: string,
  store: SyncStore,
  providerFor: ProviderResolver,
  timeZone: string,
  limit = 50,
): Promise<FlushSummary> {
  const summary: FlushSummary = { sent: 0, failed: 0, conflicts: 0 };
  const items = await store.claimOutbox(userId, limit);
  for (const item of items) {
    try {
      const outcome = item.op === "delete" ? await sendDelete(item, store, providerFor) : await sendUpsert(item, userId, store, providerFor, timeZone);
      if (outcome === "conflict") summary.conflicts++;
      await store.doneOutbox(item.id);
      summary.sent++;
    } catch (error) {
      summary.failed++;
      const code = codeOf(error);
      // Access gone or the event refused: trying again changes nothing.
      const drop = code === "auth" || code === "forbidden" || code === "invalid" || item.attempts + 1 >= OUTBOX_MAX_ATTEMPTS;
      await store.failOutbox(item.id, code, drop);
    }
  }
  return summary;
}

async function sendDelete(item: OutboxItem, store: SyncStore, providerFor: ProviderResolver) {
  const link = item.link;
  if (!link) return "skipped" as const;
  const [provider, calendar] = await Promise.all([providerFor(link.connection_id), store.calendar(link.calendar_id)]);
  if (!provider || !calendar || !calendar.canWrite) return "skipped" as const;
  const target: LinkTarget = { externalId: link.external_id, etag: link.etag, recurringId: link.recurring_id };
  await provider.deleteEvent(calendar.externalId, target);
  return "sent" as const;
}

async function sendUpsert(
  item: OutboxItem,
  userId: string,
  store: SyncStore,
  providerFor: ProviderResolver,
  timeZone: string,
): Promise<"sent" | "skipped" | "conflict"> {
  const [event] = await store.events([item.eventId]);
  if (!event || event.is_demo || event.source === "deal_deadline") return "skipped";
  const link = await store.linkOf(event.id);
  const calendar = link ? await store.calendar(link.calendarId) : await store.writeCalendar(userId);
  if (!calendar || !calendar.canWrite) return "skipped";
  const provider = await providerFor(calendar.connectionId);
  if (!provider) return "skipped";
  const booking = event.source === "booking" ? await store.bookingOf(event.id) : null;
  const target: LinkTarget | null = link
    ? { externalId: link.externalId, etag: link.etag, recurringId: link.recurringId }
    : null;

  let result = await provider.putEvent(calendar.externalId, outgoing(event, timeZone, booking, !link), target);
  let conflict = false;
  if (!result.ok && result.reason === "conflict") {
    conflict = true;
    const remote = result.remote;
    if (remote && conflictWinner(event.updated_at, remote.updatedAt) === "external") {
      // The other side is newer: it comes into Gradus, nothing goes out.
      await applyChunks(store, calendar.id, [toApplyRow(remote, "external")], [], []);
      return "conflict";
    }
    if (remote) {
      // Gradus is newer: written again over what is there now.
      result = await provider.putEvent(
        calendar.externalId,
        outgoing(event, timeZone, booking, false),
        { externalId: remote.externalId, etag: remote.etag, recurringId: remote.recurringId },
      );
    } else {
      result = { ok: false, reason: "gone" };
    }
  }
  if (!result.ok && result.reason === "gone") {
    if (link?.origin === "external") {
      // Deleted in the other calendar: gone from Gradus too.
      await applyChunks(store, calendar.id, [], [link.externalId], []);
      return conflict ? "conflict" : "sent";
    }
    result = await provider.putEvent(calendar.externalId, outgoing(event, timeZone, booking, true), null);
  }
  if (!result.ok) throw new ProviderError("unknown");

  await store.saveLink({
    eventId: event.id,
    calendarId: calendar.id,
    connectionId: calendar.connectionId,
    externalId: result.event.externalId,
    recurringId: result.event.recurringId,
    etag: result.event.etag,
    origin: link?.origin ?? "gradus",
    syncedAt: event.updated_at,
    externalUpdatedAt: result.event.updatedAt,
  });
  if (provider.key === "apple" && result.event.recurringId) {
    // Writing one instance changed the resource's etag for all of them.
    await store.setSeriesEtag(calendar.id, result.event.recurringId, result.event.etag);
  }
  if (conflict) await store.markConflict(event.id, result.event.etag, "gradus");
  if (booking && result.meetLink && result.meetLink !== booking.meetLink) {
    await store.setMeetLink(booking.id, result.meetLink);
  }
  return conflict ? "conflict" : "sent";
}
