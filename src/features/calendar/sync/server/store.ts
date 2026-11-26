import "server-only";
import { bookingWriteTarget } from "@/features/scheduler/calendar-sources";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type {
  ApplyRow,
  BookingInfo,
  ConflictWinner,
  LocalEvent,
  OutboxItem,
  OutboxLink,
  StoredLink,
  SyncCalendar,
  SyncStore,
} from "../engine";

type Admin = SupabaseClient<Database>;

/**
 * The engine's database side on Supabase, admin client: every call names
 * the person (or a row the caller already found for them). Writes into
 * calendar_events go only through calendar_sync_apply (no echo back).
 */

const LINK_COLUMNS =
  "event_id, calendar_id, connection_id, external_id, recurring_id, etag, origin, synced_at";
const EVENT_COLUMNS =
  "id, user_id, actor_id, title, description, location, starts_at, ends_at, all_day, updated_at, source, is_demo";
const LINK_LIMIT = 10_000;

type LinkRow = {
  event_id: string;
  calendar_id: string;
  connection_id: string;
  external_id: string;
  recurring_id: string | null;
  etag: string | null;
  origin: string;
  synced_at: string | null;
};

function toLink(row: LinkRow): StoredLink {
  return {
    eventId: row.event_id,
    calendarId: row.calendar_id,
    connectionId: row.connection_id,
    externalId: row.external_id,
    recurringId: row.recurring_id,
    etag: row.etag,
    origin: row.origin === "gradus" ? "gradus" : "external",
    syncedAt: row.synced_at,
  };
}

type CalendarRow = {
  id: string;
  connection_id: string;
  external_id: string;
  sync_state: string | null;
  can_write: boolean;
};

function toCalendar(row: CalendarRow): SyncCalendar {
  return {
    id: row.id,
    connectionId: row.connection_id,
    externalId: row.external_id,
    syncState: row.sync_state,
    canWrite: row.can_write,
  };
}

function toOutboxLink(value: Json | null): OutboxLink | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const link = value as Record<string, unknown>;
  if (typeof link.calendar_id !== "string" || typeof link.external_id !== "string") return null;
  return {
    calendar_id: link.calendar_id,
    connection_id: typeof link.connection_id === "string" ? link.connection_id : "",
    external_id: link.external_id,
    recurring_id: typeof link.recurring_id === "string" ? link.recurring_id : null,
    etag: typeof link.etag === "string" ? link.etag : null,
    origin: link.origin === "gradus" ? "gradus" : "external",
  };
}

export function createSupabaseSyncStore(admin: Admin): SyncStore {
  const must = <T>(result: { data: T; error: { code?: string; message: string } | null }): T => {
    if (result.error)
      throw new Error(`calendar sync store: ${result.error.code ?? result.error.message}`);
    return result.data;
  };

  return {
    async links(calendarId) {
      const rows = must(
        await admin
          .from("calendar_external_links")
          .select(LINK_COLUMNS)
          .eq("calendar_id", calendarId)
          .limit(LINK_LIMIT),
      );
      return (rows ?? []).map(toLink);
    },

    async linkOf(eventId) {
      const row = must(
        await admin
          .from("calendar_external_links")
          .select(LINK_COLUMNS)
          .eq("event_id", eventId)
          .maybeSingle(),
      );
      return row ? toLink(row) : null;
    },

    async events(ids) {
      if (!ids.length) return [];
      const out: LocalEvent[] = [];
      for (let index = 0; index < ids.length; index += 200) {
        const rows = must(
          await admin
            .from("calendar_events")
            .select(EVENT_COLUMNS)
            .in("id", ids.slice(index, index + 200)),
        );
        out.push(...((rows ?? []) as LocalEvent[]));
      }
      return out;
    },

    async apply(calendarId, rows: ApplyRow[], deletes, deleteSeries) {
      must(
        await admin.rpc("calendar_sync_apply", {
          _calendar: calendarId,
          _rows: rows as unknown as Json,
          _deletes: deletes,
          _delete_series: deleteSeries,
        }),
      );
    },

    async saveState(calendarId, state) {
      must(
        await admin
          .from("calendar_connection_calendars")
          .update({ sync_state: state, synced_at: new Date().toISOString(), last_error: null })
          .eq("id", calendarId),
      );
    },

    async markConflict(eventId, etag, winner: ConflictWinner) {
      must(
        await admin
          .from("calendar_external_links")
          .update({ etag, conflict_at: new Date().toISOString(), conflict_winner: winner })
          .eq("event_id", eventId),
      );
    },

    async saveLink(link) {
      const calendar = must(
        await admin
          .from("calendar_connection_calendars")
          .select("user_id")
          .eq("id", link.calendarId)
          .single(),
      );
      must(
        await admin.from("calendar_external_links").upsert(
          {
            event_id: link.eventId,
            user_id: calendar!.user_id,
            connection_id: link.connectionId,
            calendar_id: link.calendarId,
            external_id: link.externalId,
            recurring_id: link.recurringId,
            etag: link.etag,
            external_updated_at: link.externalUpdatedAt,
            origin: link.origin,
            synced_at: link.syncedAt,
          },
          { onConflict: "event_id" },
        ),
      );
    },

    async setSeriesEtag(calendarId, recurringId, etag) {
      must(
        await admin
          .from("calendar_external_links")
          .update({ etag })
          .eq("calendar_id", calendarId)
          .eq("recurring_id", recurringId),
      );
    },

    async calendar(calendarId) {
      const row = must(
        await admin
          .from("calendar_connection_calendars")
          .select("id, connection_id, external_id, sync_state, can_write")
          .eq("id", calendarId)
          .maybeSingle(),
      );
      return row ? toCalendar(row) : null;
    },

    async writeCalendar(userId) {
      const row = must(
        await admin
          .from("calendar_connection_calendars")
          .select("id, connection_id, external_id, sync_state, can_write")
          .eq("user_id", userId)
          .eq("write", true)
          .maybeSingle(),
      );
      return row ? toCalendar(row) : null;
    },

    async claimOutbox(userId, limit) {
      const rows = must(
        await admin.rpc("calendar_sync_outbox_claim", { _user: userId, _limit: limit }),
      );
      return (rows ?? []).map((row): OutboxItem => ({
        id: row.id,
        eventId: row.event_id,
        op: row.op === "delete" ? "delete" : "upsert",
        link: toOutboxLink(row.link),
        attempts: row.attempts,
      }));
    },

    async doneOutbox(id) {
      must(await admin.from("calendar_sync_outbox").delete().eq("id", id));
    },

    async failOutbox(id, code, drop) {
      if (drop) {
        must(await admin.from("calendar_sync_outbox").delete().eq("id", id));
        return;
      }
      const row = must(
        await admin.from("calendar_sync_outbox").select("attempts").eq("id", id).maybeSingle(),
      );
      if (!row) return;
      must(
        await admin
          .from("calendar_sync_outbox")
          .update({
            attempts: row.attempts + 1,
            last_error: /^[A-Za-z]{1,32}$/.test(code) ? code : "unknown",
            claimed_until: null,
          })
          .eq("id", id),
      );
    },

    async bookingOf(eventId) {
      const booking = must(
        await admin
          .from("bookings")
          .select(
            "id, guest_email, guest_name, google_meet_link, event_type_id, host_user_id, space_id",
          )
          .eq("calendar_event_id", eventId)
          .maybeSingle(),
      );
      if (!booking) return null;
      let wantsMeet = false;
      let typeSources: unknown = null;
      if (booking.event_type_id) {
        const type = must(
          await admin
            .from("event_types")
            .select("location_kind, video_source, calendar_sources")
            .eq("id", booking.event_type_id)
            .maybeSingle(),
        );
        wantsMeet = type?.location_kind === "video" && type.video_source === "google_meet";
        typeSources = type?.calendar_sources ?? null;
      }
      const profile = booking.host_user_id
        ? must(
            await admin
              .from("scheduler_profiles")
              .select("calendar_sources")
              .eq("user_id", booking.host_user_id)
              .eq("space_id", booking.space_id)
              .maybeSingle(),
          )
        : null;
      const info: BookingInfo = {
        id: booking.id,
        guestEmail: booking.guest_email,
        guestName: booking.guest_name,
        wantsMeet,
        meetLink: booking.google_meet_link,
        target: bookingWriteTarget(profile?.calendar_sources ?? null, typeSources),
      };
      return info;
    },

    async setMeetLink(bookingId, link) {
      must(await admin.from("bookings").update({ google_meet_link: link }).eq("id", bookingId));
    },
  };
}
