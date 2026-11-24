import type {
  ApplyRow,
  BookingInfo,
  ConflictWinner,
  LocalEvent,
  OutboxItem,
  StoredLink,
  SyncCalendar,
  SyncStore,
} from "../engine";

/**
 * The database side of the sync in memory, for the tests (28.10). It does
 * what calendar_sync_apply, the outbox trigger and the links do in SQL:
 * `editLocal` / `createLocal` / `deleteLocal` are changes made in Gradus
 * (queued), `apply` is what the server writes from the other calendar (never
 * queued).
 */

export type MemoryLink = StoredLink & {
  conflictWinner: ConflictWinner | null;
  transparent: boolean;
  externalUpdatedAt: string | null;
};

export class MemoryStore implements SyncStore {
  readonly eventRows = new Map<string, LocalEvent>();
  readonly linkRows = new Map<string, MemoryLink>();
  outbox: OutboxItem[] = [];
  readonly calendars = new Map<string, SyncCalendar & { userId: string; write: boolean }>();
  readonly bookings = new Map<string, BookingInfo & { eventId: string }>();
  states = new Map<string, string | null>();
  private nextId = 1;
  private nextOutbox = 1;

  constructor(
    private readonly userId: string,
    private readonly clock: () => number,
  ) {}

  private stamp() {
    return new Date(this.clock()).toISOString();
  }

  addCalendar(calendar: SyncCalendar & { write?: boolean }) {
    this.calendars.set(calendar.id, { ...calendar, userId: this.userId, write: calendar.write ?? false });
  }

  private enqueue(eventId: string, op: "upsert" | "delete", link: MemoryLink | null) {
    if (op === "upsert" && this.outbox.some((item) => item.eventId === eventId && item.op === "upsert")) return;
    const hasWrite = [...this.calendars.values()].some((calendar) => calendar.write);
    if (!link && !hasWrite) return;
    this.outbox.push({
      id: this.nextOutbox++,
      eventId,
      op,
      attempts: 0,
      link:
        op === "delete" && link
          ? {
              calendar_id: link.calendarId,
              connection_id: link.connectionId,
              external_id: link.externalId,
              recurring_id: link.recurringId,
              etag: link.etag,
              origin: link.origin,
            }
          : null,
    });
  }

  createLocal(input: Partial<LocalEvent> & { title: string; starts_at: string }, source = "manual"): LocalEvent {
    const event: LocalEvent = {
      id: `ev${this.nextId++}`,
      user_id: this.userId,
      actor_id: this.userId,
      description: null,
      location: null,
      ends_at: null,
      all_day: false,
      is_demo: false,
      ...input,
      source,
      updated_at: this.stamp(),
    };
    this.eventRows.set(event.id, event);
    this.enqueue(event.id, "upsert", this.linkRows.get(event.id) ?? null);
    return event;
  }

  editLocal(id: string, patch: Partial<LocalEvent>) {
    const event = this.eventRows.get(id);
    if (!event) throw new Error(`no event ${id}`);
    this.eventRows.set(id, { ...event, ...patch, updated_at: this.stamp() });
    this.enqueue(id, "upsert", this.linkRows.get(id) ?? null);
  }

  deleteLocal(id: string) {
    const link = this.linkRows.get(id) ?? null;
    if (link) this.enqueue(id, "delete", link);
    this.eventRows.delete(id);
    this.linkRows.delete(id);
  }

  byExternal(externalId: string): LocalEvent | undefined {
    const link = [...this.linkRows.values()].find((row) => row.externalId === externalId);
    return link ? this.eventRows.get(link.eventId) : undefined;
  }

  /** Disconnect: what was read in leaves, Gradus's own stay unlinked (calendar_sync_forget). */
  forget(connectionId: string) {
    for (const link of [...this.linkRows.values()]) {
      if (link.connectionId !== connectionId) continue;
      if (link.origin === "external") this.eventRows.delete(link.eventId);
      this.linkRows.delete(link.eventId);
    }
    this.outbox = this.outbox.filter((item) => item.link?.connection_id !== connectionId);
  }

  // SyncStore ---------------------------------------------------------------

  async links(calendarId: string) {
    return [...this.linkRows.values()].filter((link) => link.calendarId === calendarId);
  }

  async linkOf(eventId: string) {
    return this.linkRows.get(eventId) ?? null;
  }

  async events(ids: string[]) {
    return ids.map((id) => this.eventRows.get(id)).filter((event): event is LocalEvent => Boolean(event));
  }

  async apply(calendarId: string, rows: ApplyRow[], deletes: string[], deleteSeries: string[]) {
    const calendar = this.calendars.get(calendarId);
    if (!calendar) throw new Error("not_found");
    for (const row of rows) {
      const link = [...this.linkRows.values()].find(
        (item) => item.calendarId === calendarId && item.externalId === row.external_id,
      );
      const fields = {
        title: row.title || "—",
        description: row.description,
        location: row.location,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        all_day: row.all_day,
      };
      if (link) {
        const event = this.eventRows.get(link.eventId)!;
        const updated = event.source === "booking" ? event : { ...event, ...fields, updated_at: this.stamp() };
        this.eventRows.set(event.id, updated);
        this.linkRows.set(event.id, {
          ...link,
          etag: row.etag,
          externalUpdatedAt: row.external_updated_at,
          recurringId: row.recurring_id,
          transparent: row.transparent,
          syncedAt: updated.updated_at,
          conflictWinner: row.conflict ?? link.conflictWinner,
        });
        this.outbox = this.outbox.filter((item) => !(item.eventId === event.id && item.op === "upsert"));
      } else {
        const event: LocalEvent = {
          id: `ev${this.nextId++}`,
          user_id: calendar.userId,
          actor_id: calendar.userId,
          ...fields,
          source: "external",
          is_demo: false,
          updated_at: this.stamp(),
        };
        this.eventRows.set(event.id, event);
        this.linkRows.set(event.id, {
          eventId: event.id,
          calendarId,
          connectionId: calendar.connectionId,
          externalId: row.external_id,
          recurringId: row.recurring_id,
          etag: row.etag,
          origin: "external",
          syncedAt: event.updated_at,
          conflictWinner: null,
          transparent: row.transparent,
          externalUpdatedAt: row.external_updated_at,
        });
      }
    }
    for (const link of [...this.linkRows.values()]) {
      if (link.calendarId !== calendarId) continue;
      const gone =
        deletes.includes(link.externalId) || (link.recurringId !== null && deleteSeries.includes(link.recurringId));
      if (!gone) continue;
      const event = this.eventRows.get(link.eventId);
      if (event?.source !== "booking") this.eventRows.delete(link.eventId);
      this.linkRows.delete(link.eventId);
    }
  }

  async saveState(calendarId: string, state: string | null) {
    this.states.set(calendarId, state);
    const calendar = this.calendars.get(calendarId);
    if (calendar) this.calendars.set(calendarId, { ...calendar, syncState: state });
  }

  async markConflict(eventId: string, etag: string | null, winner: ConflictWinner) {
    const link = this.linkRows.get(eventId);
    if (link) this.linkRows.set(eventId, { ...link, etag, conflictWinner: winner });
  }

  async saveLink(link: StoredLink & { externalUpdatedAt: string | null }) {
    const previous = this.linkRows.get(link.eventId);
    this.linkRows.set(link.eventId, {
      ...link,
      conflictWinner: previous?.conflictWinner ?? null,
      transparent: previous?.transparent ?? false,
    });
  }

  async setSeriesEtag(calendarId: string, recurringId: string, etag: string | null) {
    for (const link of this.linkRows.values()) {
      if (link.calendarId === calendarId && link.recurringId === recurringId) link.etag = etag;
    }
  }

  async calendar(calendarId: string) {
    return this.calendars.get(calendarId) ?? null;
  }

  async writeCalendar() {
    return [...this.calendars.values()].find((calendar) => calendar.write) ?? null;
  }

  async claimOutbox(_userId: string, limit: number) {
    return this.outbox.slice(0, limit);
  }

  async doneOutbox(id: number) {
    this.outbox = this.outbox.filter((item) => item.id !== id);
  }

  async failOutbox(id: number, _code: string, drop: boolean) {
    this.outbox = drop
      ? this.outbox.filter((item) => item.id !== id)
      : this.outbox.map((item) => (item.id === id ? { ...item, attempts: item.attempts + 1 } : item));
  }

  async bookingOf(eventId: string) {
    return [...this.bookings.values()].find((booking) => booking.eventId === eventId) ?? null;
  }

  async setMeetLink(bookingId: string, link: string) {
    const booking = this.bookings.get(bookingId);
    if (booking) this.bookings.set(bookingId, { ...booking, meetLink: link });
  }
}
