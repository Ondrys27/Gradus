import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { toEventType } from "../event-type-form";
import {
  activeBookings,
  computeSlots,
  mergeIntervals,
  rulesFor,
  slotsByGuestDay,
  type BookingBusy,
  type GuestDay,
  type Interval,
} from "../slots";
import {
  EVENT_TYPE_COLUMNS,
  OVERRIDE_COLUMNS,
  RULE_COLUMNS,
  type EventType,
  type EventTypeRow,
} from "../types";
import { addDays, dayIn, isValidTimeZone, type Day } from "../zoned";

/**
 * What keeps a host busy, read with the admin client for one person, and
 * the free slots of their meeting type. Shared by the host's preview and the
 * public booking page (24.4); both call it only after deciding whose type it
 * is, and filter every query by that person explicitly.
 *
 * Busy: the host's own Gradus events with a time (not all-day ones, not the
 * tutorial's samples, not the meetings of other people in the company),
 * their open sales tasks with a time, the busy times of their subscribed
 * calendars, and every active booking or unexpired hold of theirs.
 */

type Admin = SupabaseClient<Database>;

const MINUTE = 60_000;
const DAY = 86_400_000;
/** An event without an end is drawn as an hour; it blocks an hour too. */
const EVENT_DEFAULT_MIN = 60;
const ROW_LIMIT = 2000;

export type HostBusy = {
  busy: Interval[];
  bookings: Array<Interval & { eventTypeId: string | null }>;
};

function parseBusyJson(value: unknown): Interval[] {
  if (!Array.isArray(value)) return [];
  const out: Interval[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const start = Date.parse(String((raw as Record<string, unknown>).start));
    const end = Date.parse(String((raw as Record<string, unknown>).end));
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) out.push({ start, end });
  }
  return out;
}

/** The spaces the person belongs to now: their own and the companies they actively work for. */
async function spacesOf(admin: Admin, userId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("memberships")
    .select("space_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(100);
  if (error) throw error;
  return [...new Set([userId, ...(data ?? []).map((row) => row.space_id)])];
}

/** A booking being moved: its own time and its meeting in the calendar do not block it. */
export type BusyExclude = { bookingId: string; calendarEventId: string | null };

export async function loadHostBusy(
  admin: Admin,
  hostUserId: string,
  range: { from: number; to: number },
  now = Date.now(),
  exclude?: BusyExclude,
): Promise<HostBusy> {
  const spaces = await spacesOf(admin, hostUserId);
  const fromIso = new Date(range.from - DAY).toISOString();
  const toIso = new Date(range.to).toISOString();
  const [events, tasks, subscriptions, bookings] = await Promise.all([
    admin
      .from("calendar_events")
      .select("id, starts_at, ends_at")
      .in("user_id", spaces)
      // Their own: made by them, or in their own space before anyone was named.
      .or(`actor_id.eq.${hostUserId},and(user_id.eq.${hostUserId},actor_id.is.null)`)
      .eq("all_day", false)
      .eq("is_demo", false)
      .gte("starts_at", fromIso)
      .lt("starts_at", toIso)
      .limit(ROW_LIMIT),
    admin
      .from("crm_tasks")
      .select("due_at, duration_minutes")
      .in("user_id", spaces)
      .eq("assignee_id", hostUserId)
      .eq("status", "open")
      .eq("is_demo", false)
      .gte("due_at", fromIso)
      .lt("due_at", toIso)
      .limit(ROW_LIMIT),
    admin.from("calendar_subscriptions").select("busy").eq("user_id", hostUserId).limit(10),
    admin
      .from("bookings")
      .select("id, event_type_id, starts_at, ends_at, status, hold_expires_at")
      .eq("host_user_id", hostUserId)
      .in("status", ["held", "pending", "confirmed"])
      .gte("ends_at", new Date(range.from).toISOString())
      .lt("starts_at", toIso)
      .limit(ROW_LIMIT),
  ]);
  for (const result of [events, tasks, subscriptions, bookings])
    if (result.error) throw result.error;

  const busy: Interval[] = [];
  for (const event of events.data ?? []) {
    if (exclude?.calendarEventId && event.id === exclude.calendarEventId) continue;
    const start = Date.parse(event.starts_at);
    const end = event.ends_at ? Date.parse(event.ends_at) : start + EVENT_DEFAULT_MIN * MINUTE;
    busy.push({ start, end: Math.max(end, start + MINUTE) });
  }
  for (const task of tasks.data ?? []) {
    const start = Date.parse(task.due_at);
    busy.push({ start, end: start + Math.max(1, task.duration_minutes) * MINUTE });
  }
  for (const subscription of subscriptions.data ?? [])
    busy.push(...parseBusyJson(subscription.busy));

  return {
    busy: mergeIntervals(busy),
    bookings: activeBookings(
      (bookings.data ?? []).filter((booking) => booking.id !== exclude?.bookingId),
      now,
    ).map((booking) => ({
      start: Date.parse(booking.starts_at),
      end: Date.parse(booking.ends_at),
      eventTypeId: booking.event_type_id,
    })),
  };
}

export type TypeSlots = { timeZone: string; days: GuestDay[] };

/**
 * The free slots of one meeting type in the guest's zone. `type` is the row
 * the caller already found and checked; the rest is read for its profile.
 */
export async function loadTypeSlots(
  admin: Admin,
  typeRow: EventTypeRow,
  guestTimeZone: string,
  now = Date.now(),
  exclude?: BusyExclude,
): Promise<TypeSlots> {
  const type: EventType = toEventType(typeRow);
  const [profile, rules, overrides] = await Promise.all([
    admin.from("scheduler_profiles").select("time_zone").eq("id", type.profile_id).maybeSingle(),
    admin
      .from("availability_rules")
      .select(RULE_COLUMNS)
      .eq("profile_id", type.profile_id)
      .limit(500),
    admin
      .from("availability_overrides")
      .select(OVERRIDE_COLUMNS)
      .eq("profile_id", type.profile_id)
      .gte("date", new Date(now - 2 * DAY).toISOString().slice(0, 10))
      .limit(500),
  ]);
  for (const result of [profile, rules, overrides]) if (result.error) throw result.error;
  const hostZone = profile.data?.time_zone ?? "Europe/Prague";
  const today: Day = dayIn(now, hostZone);
  const last = addDays(today, type.max_days_ahead);
  const host = await loadHostBusy(
    admin,
    type.user_id,
    { from: now, to: now + (type.max_days_ahead + 2) * DAY },
    now,
    exclude,
  );
  const bookings: BookingBusy[] = host.bookings.map((booking) => ({
    start: booking.start,
    end: booking.end,
    sameType: booking.eventTypeId === type.id,
  }));
  const slots = computeSlots({
    hostTimeZone: hostZone,
    rules: rulesFor(rules.data ?? [], type),
    overrides: overrides.data ?? [],
    busy: host.busy,
    bookings,
    type: {
      durationMin: type.duration_min,
      bufferBeforeMin: type.buffer_before_min,
      bufferAfterMin: type.buffer_after_min,
      minNoticeHours: type.min_notice_hours,
      maxDaysAhead: type.max_days_ahead,
      maxPerDay: type.max_per_day,
      slotStepMin: type.slot_step_min,
    },
    now,
    from: today,
    to: last,
  });
  const zone = isValidTimeZone(guestTimeZone) ? guestTimeZone : hostZone;
  return { timeZone: zone, days: slotsByGuestDay(slots, zone) };
}

/** The meeting type row by id, all columns, for the loaders above. */
export async function loadTypeRow(admin: Admin, id: string): Promise<EventTypeRow | null> {
  const { data, error } = await admin
    .from("event_types")
    .select(EVENT_TYPE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as EventTypeRow | null;
}
