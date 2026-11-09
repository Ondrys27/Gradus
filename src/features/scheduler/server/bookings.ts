import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverTranslator } from "@/i18n/server-translator";
import { track } from "@/lib/analytics/track";
import { APP_NAME } from "@/lib/constants";
import { formatPhone } from "@/lib/phone";
import { countryFromTimeZone } from "@/lib/region";
import { USER_SETTINGS_COLUMNS, toFormatSettings, type UserSettings } from "@/lib/user-settings";
import type { Database, Json } from "@/types/database";
import { answerLines, checkAnswers, type AnswerInput } from "../booking/answers";
import { guestFormatSettings } from "../booking/guest-format";
import { isBookingLocale, type BookingLocale } from "../booking/page-locale";
import {
  parseReminderIds,
  planReminders,
  type ScheduledReminder,
} from "../booking/reminders";
import { bookingAppPath } from "../booking/paths";
import { bookingProblem, type BookingProblem } from "../booking/state";
import {
  bookingTokenHash,
  isBookingToken,
  managePath,
  manageTokenFor,
  newHoldToken,
} from "../booking/tokens";
import { toEventType } from "../event-type-form";
import { bookingUrl } from "../handle";
import { buildBookingIcs, type BookingIcsStatus } from "../ics/export";
import {
  EVENT_TYPE_COLUMNS,
  PROFILE_COLUMNS,
  type EventType,
  type EventTypeRow,
  type SchedulerProfile,
} from "../types";
import { isValidTimeZone } from "../zoned";
import {
  guestBookingEmail,
  hostBookingEmail,
  type GuestMailKind,
  type HostMailKind,
  type MailMeeting,
} from "./booking-emails";
import { loadTypeSlots } from "./busy";
import { cancelBookingMail, deliverBookingMail } from "./mail";
import {
  loadHostOfProfile,
  loadPublicProfile,
  loadPublicTypeRow,
  type PublicHost,
} from "./public-data";

/**
 * Bookings of the scheduler (24.4) on the server: the public page holds a
 * time and books it, the host approves, declines, moves and cancels, the
 * guest moves and cancels through the link of their e-mail. Every state
 * change is one database function (scheduler_*: the rules under the host's
 * lock); around it this file writes what follows: the contact, the meeting
 * in the calendar and the deal (scheduler_booking_effects), the e-mails with
 * the .ics, the scheduled reminders and Jarvis's bubble for the host.
 *
 * Admin client throughout: the guest has no session, and the host's actions
 * reach this only after the caller checked the session (booking-actions.ts).
 * Every query names the booking or the person explicitly. Mail and effects
 * that fail are logged and never undo the booking itself.
 */

type Admin = SupabaseClient<Database>;

export const BOOKING_FULL_COLUMNS =
  "id, event_type_id, host_user_id, space_id, starts_at, ends_at, guest_name, guest_email, guest_phone, guest_company, guest_time_zone, answers, status, hold_expires_at, contact_id, calendar_event_id, deal_id, reminder_ids, cancelled_by, cancel_reason, locale, confirmed_at, rescheduled_at, reschedule_count, no_show_at, created_at";

export type FullBooking = Pick<
  Database["public"]["Tables"]["bookings"]["Row"],
  | "id"
  | "event_type_id"
  | "host_user_id"
  | "space_id"
  | "starts_at"
  | "ends_at"
  | "guest_name"
  | "guest_email"
  | "guest_phone"
  | "guest_company"
  | "guest_time_zone"
  | "answers"
  | "status"
  | "hold_expires_at"
  | "contact_id"
  | "calendar_event_id"
  | "deal_id"
  | "reminder_ids"
  | "cancelled_by"
  | "cancel_reason"
  | "locale"
  | "confirmed_at"
  | "rescheduled_at"
  | "reschedule_count"
  | "no_show_at"
  | "created_at"
>;

export type BookingContext = {
  booking: FullBooking;
  type: EventType | null;
  profile: SchedulerProfile | null;
  host: PublicHost | null;
  hostEmail: string | null;
  hostLocale: string;
  hostSettings: ReturnType<typeof toFormatSettings>;
  origin: string;
};

export type FlowResult<T> = { ok: true; data: T } | { ok: false; problem: BookingProblem };

function must<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw result.error;
  return result.data;
}

function log(label: string, error: unknown) {
  console.error(`[scheduler] ${label}`, error instanceof Error ? error.message : (error as { message?: string })?.message ?? "unknown");
}

function manageKey(): string {
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not set");
  return key;
}

/** The guest's link of one booking (moving, cancelling), absolute. */
export function manageUrlOf(bookingId: string, origin: string): string {
  return `${origin}${managePath(manageTokenFor(bookingId, manageKey()))}`;
}

/** The booking of a link's token, by its hash; null for anything else. */
export async function bookingIdByToken(admin: Admin, token: string): Promise<string | null> {
  if (!isBookingToken(token)) return null;
  const { data, error } = await admin
    .from("bookings")
    .select("id")
    .eq("manage_token_hash", bookingTokenHash(token))
    .in("status", ["pending", "confirmed", "cancelled", "declined"])
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}


// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export async function loadBookingContext(
  admin: Admin,
  bookingId: string,
  origin: string,
): Promise<BookingContext | null> {
  const booking = must(
    await admin.from("bookings").select(BOOKING_FULL_COLUMNS).eq("id", bookingId).maybeSingle(),
  ) as FullBooking | null;
  if (!booking) return null;
  const hostId = booking.host_user_id;
  const [typeRow, profile, settings, user] = await Promise.all([
    booking.event_type_id
      ? admin.from("event_types").select(EVENT_TYPE_COLUMNS).eq("id", booking.event_type_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    hostId
      ? admin
          .from("scheduler_profiles")
          .select(PROFILE_COLUMNS)
          .eq("user_id", hostId)
          .eq("space_id", booking.space_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    hostId
      ? admin.from("user_settings").select(USER_SETTINGS_COLUMNS).eq("user_id", hostId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    hostId ? admin.auth.admin.getUserById(hostId) : Promise.resolve(null),
  ]);
  const type = must(typeRow) ? toEventType(must(typeRow) as EventTypeRow) : null;
  const profileRow = must(profile) as SchedulerProfile | null;
  const settingsRow = must(settings) as UserSettings | null;
  return {
    booking,
    type,
    profile: profileRow,
    host: profileRow ? await loadHostOfProfile(admin, profileRow) : null,
    hostEmail: user && "data" in user ? (user.data.user?.email ?? null) : null,
    hostLocale: settingsRow?.locale ?? "cs",
    hostSettings: toFormatSettings(settingsRow),
    origin,
  };
}

function guestLocale(ctx: BookingContext): BookingLocale {
  return isBookingLocale(ctx.booking.locale) ? ctx.booking.locale : "cs";
}

function guestZone(ctx: BookingContext): string {
  const zone = ctx.booking.guest_time_zone;
  return zone && isValidTimeZone(zone) ? zone : (ctx.profile?.time_zone ?? "Europe/Prague");
}

function meetingOf(ctx: BookingContext, locale: string, withVideo: boolean): MailMeeting {
  const { booking, type } = ctx;
  return {
    typeName: type?.name ?? serverTranslator(locale)("email.booking.meeting"),
    durationMin: Math.round((Date.parse(booking.ends_at) - Date.parse(booking.starts_at)) / 60_000),
    startsAt: booking.starts_at,
    locationKind: type?.location_kind ?? "video",
    locationText: type?.location_text ?? null,
    // The call's link only for a video meeting, and only once it is confirmed.
    videoLink:
      withVideo && (type?.location_kind ?? "video") === "video" ? (ctx.profile?.video_link ?? null) : null,
    hostName: ctx.host?.name ?? ctx.profile?.handle ?? "",
    guestName: booking.guest_name ?? "",
    guestEmail: booking.guest_email ?? "",
    guestPhone: booking.guest_phone,
    guestCompany: booking.guest_company,
    confirmationNote: type?.confirmation_note ?? null,
  };
}

function answersOf(ctx: BookingContext, locale: string): string[] {
  const t = serverTranslator(locale);
  const answers =
    ctx.booking.answers && typeof ctx.booking.answers === "object" && !Array.isArray(ctx.booking.answers)
      ? (ctx.booking.answers as Record<string, unknown>)
      : {};
  return answerLines(ctx.type?.questions ?? [], answers, {
    yes: t("email.booking.yes"),
    no: t("email.booking.no"),
  });
}

// ---------------------------------------------------------------------------
// Effects: contact, the meeting in the calendar, Cold Calling, the deal
// ---------------------------------------------------------------------------

async function runEffects(admin: Admin, ctx: BookingContext, confirming: boolean) {
  const t = serverTranslator(ctx.hostLocale);
  const { booking, type } = ctx;
  const typeName = type?.name ?? t("email.booking.meeting");
  const guest = booking.guest_name ?? "";
  const phone = booking.guest_phone ? formatPhone(booking.guest_phone, ctx.host?.country ?? null) : null;
  const lines = [
    t("scheduler.bookingEvent.bookedVia"),
    ...(booking.guest_email ? [t("email.booking.guestEmail", { email: booking.guest_email })] : []),
    ...(phone ? [t("email.booking.guestPhone", { phone })] : []),
    ...(booking.guest_company ? [t("email.booking.guestCompany", { company: booking.guest_company })] : []),
    ...answersOf(ctx, ctx.hostLocale),
  ];
  const location =
    type?.location_kind === "video"
      ? (ctx.profile?.video_link ?? "")
      : type?.location_kind === "phone"
        ? (phone ?? "")
        : (type?.location_text ?? "");
  const zone = booking.guest_time_zone;
  const country =
    (zone && isValidTimeZone(zone) ? countryFromTimeZone(zone) : null) ?? ctx.host?.country ?? null;
  const { data, error } = await admin.rpc("scheduler_booking_effects", {
    _booking: booking.id,
    _confirming: confirming,
    _title: t("scheduler.bookingEvent.title", { type: typeName, guest }),
    _description: lines.join("\n"),
    _location: location,
    _deal_title: booking.guest_company?.trim() || guest,
    ...(country ? { _country: country } : {}),
  });
  if (error) throw error;
  const result = (data ?? {}) as { contact_id?: string; calendar_event_id?: string | null; deal_id?: string | null };
  ctx.booking = {
    ...booking,
    contact_id: result.contact_id ?? booking.contact_id,
    calendar_event_id: result.calendar_event_id ?? null,
    deal_id: result.deal_id ?? booking.deal_id,
  };
}

async function effectsSafely(admin: Admin, ctx: BookingContext, confirming: boolean) {
  try {
    await runEffects(admin, ctx, confirming);
  } catch (error) {
    log("booking effects failed", error);
  }
}

// ---------------------------------------------------------------------------
// E-mails
// ---------------------------------------------------------------------------

/** The one UID a booking's calendar event has, in e-mails and on the page. */
export function icsUidOf(bookingId: string): string {
  return `booking-${bookingId}`;
}

function icsAttachment(ctx: BookingContext, status: BookingIcsStatus, locale: string, now: Date) {
  const meeting = meetingOf(ctx, locale, status === "CONFIRMED");
  const t = serverTranslator(locale);
  const ics = buildBookingIcs({
    uid: icsUidOf(ctx.booking.id),
    // Grows with every change, so a calendar updates the event it imported.
    sequence: Math.floor(now.getTime() / 1000) % 2_000_000_000,
    status,
    title: t("email.booking.icsTitle", { type: meeting.typeName, host: meeting.hostName }),
    start: ctx.booking.starts_at,
    end: ctx.booking.ends_at,
    now,
    location:
      meeting.locationKind === "video"
        ? meeting.videoLink
        : meeting.locationKind === "phone"
          ? null
          : meeting.locationText,
    url: meeting.videoLink,
    product: ctx.host?.brandingHidden ? "Booking" : APP_NAME,
  });
  return { filename: "invite.ics", content: Buffer.from(ics, "utf8").toString("base64") };
}

async function emailGuest(
  ctx: BookingContext,
  kind: GuestMailKind,
  extra: {
    reason?: string | null;
    alternative?: string | null;
    previousStartsAt?: string | null;
    ics?: BookingIcsStatus;
    scheduledAt?: string;
    reminderMinutes?: number;
  } = {},
) {
  const to = ctx.booking.guest_email;
  if (!to) return { ok: false as const, error: "no address" };
  const locale = guestLocale(ctx);
  const settings = guestFormatSettings(locale, guestZone(ctx));
  const live = ["confirmed", "pending", "approved", "rescheduled", "reminder"].includes(kind);
  const withVideo = ctx.booking.status === "confirmed";
  const profile = ctx.profile;
  const mail = guestBookingEmail({
    kind,
    meeting: meetingOf(ctx, locale, withVideo),
    locale,
    settings,
    manageUrl: live ? manageUrlOf(ctx.booking.id, ctx.origin) : null,
    bookAgainUrl:
      profile && ctx.type?.active ? bookingUrl(ctx.origin, profile.handle, ctx.type.slug) : null,
    reason: extra.reason,
    alternative: extra.alternative,
    previousStartsAt: extra.previousStartsAt,
    reminderMinutes: extra.reminderMinutes,
    brandingHidden: Boolean(ctx.host?.brandingHidden),
  });
  return deliverBookingMail({
    to,
    ...mail,
    fromName: ctx.host?.name,
    ...(ctx.hostEmail ? { replyTo: ctx.hostEmail } : {}),
    ...(extra.ics ? { attachments: [icsAttachment(ctx, extra.ics, locale, new Date())] } : {}),
    ...(extra.scheduledAt ? { scheduledAt: extra.scheduledAt } : {}),
  });
}

async function emailHost(
  ctx: BookingContext,
  kind: HostMailKind,
  extra: {
    reason?: string | null;
    previousStartsAt?: string | null;
    scheduledAt?: string;
    reminderMinutes?: number;
  } = {},
) {
  if (!ctx.hostEmail) return { ok: false as const, error: "no address" };
  const mail = hostBookingEmail({
    kind,
    meeting: meetingOf(ctx, ctx.hostLocale, true),
    locale: ctx.hostLocale,
    settings: ctx.hostSettings,
    country: ctx.host?.country ?? null,
    appUrl: `${ctx.origin}${bookingAppPath(ctx.booking.id)}`,
    answers: answersOf(ctx, ctx.hostLocale),
    reason: extra.reason,
    previousStartsAt: extra.previousStartsAt,
    reminderMinutes: extra.reminderMinutes,
  });
  return deliverBookingMail({
    to: ctx.hostEmail,
    ...mail,
    ...(ctx.booking.guest_email ? { replyTo: ctx.booking.guest_email } : {}),
    ...(extra.scheduledAt ? { scheduledAt: extra.scheduledAt } : {}),
  });
}

async function mailSafely(label: string, send: () => Promise<{ ok: boolean; error?: string }>) {
  try {
    const result = await send();
    if (!result.ok && result.error !== "internal address" && result.error !== "no address") {
      console.error(`[scheduler] ${label} e-mail failed`, result.error);
    }
  } catch (error) {
    log(`${label} e-mail failed`, error);
  }
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

async function saveReminders(admin: Admin, bookingId: string, list: ScheduledReminder[]) {
  const { error } = await admin
    .from("bookings")
    .update({ reminder_ids: list as unknown as Json })
    .eq("id", bookingId);
  if (error) throw error;
}

/** Schedules the reminders now in Resend's window; the rest waits for the daily cron. */
export async function scheduleReminders(admin: Admin, ctx: BookingContext, now = Date.now()) {
  if (ctx.booking.status !== "confirmed") return 0;
  const scheduled = parseReminderIds(ctx.booking.reminder_ids);
  const planned = planReminders({
    startsAt: ctx.booking.starts_at,
    offsets: (ctx.type?.reminders ?? []).map((reminder) => reminder.offset_minutes),
    now,
    scheduled,
  });
  if (!planned.length) return 0;
  const list = [...scheduled];
  for (const item of planned) {
    const result =
      item.target === "guest"
        ? await emailGuest(ctx, "reminder", { scheduledAt: item.at, reminderMinutes: item.offsetMinutes })
        : await emailHost(ctx, "reminder", { scheduledAt: item.at, reminderMinutes: item.offsetMinutes });
    if (result.ok) {
      list.push({ key: item.key, id: result.id, at: item.at });
    } else if (result.error === "internal address" || result.error === "no address") {
      // Nobody to send it to: done, so the cron does not try again.
      list.push({ key: item.key, id: null, at: item.at });
    } else {
      console.error("[scheduler] reminder failed", result.error);
    }
  }
  ctx.booking = { ...ctx.booking, reminder_ids: list as unknown as Json };
  await saveReminders(admin, ctx.booking.id, list);
  return planned.length;
}

/** Cancels every reminder still to come (a move or a cancellation). */
export async function cancelReminders(admin: Admin, ctx: BookingContext, now = Date.now()) {
  const scheduled = parseReminderIds(ctx.booking.reminder_ids);
  if (!scheduled.length) return;
  for (const item of scheduled) {
    if (item.id && Date.parse(item.at) > now) {
      const cancelled = await cancelBookingMail(item.id).catch(() => false);
      if (!cancelled) console.error("[scheduler] reminder cancel failed");
    }
  }
  ctx.booking = { ...ctx.booking, reminder_ids: [] };
  await saveReminders(admin, ctx.booking.id, []);
}

/**
 * The daily cron: reminders of confirmed meetings that were too far ahead for
 * Resend when booked and have now come into its window.
 */
export async function scheduleDueReminders(admin: Admin, origin: string, now = Date.now()) {
  const { data, error } = await admin
    .from("bookings")
    .select("id, starts_at, reminder_ids, event_type:event_types(reminders)")
    .eq("status", "confirmed")
    .gt("starts_at", new Date(now).toISOString())
    .lt("starts_at", new Date(now + 40 * 86_400_000).toISOString())
    .order("starts_at")
    .limit(500);
  if (error) throw error;
  let scheduled = 0;
  for (const row of data ?? []) {
    const offsets = Array.isArray(row.event_type?.reminders)
      ? (row.event_type.reminders as Array<{ offset_minutes?: unknown }>).flatMap((item) =>
          typeof item?.offset_minutes === "number" ? [item.offset_minutes] : [],
        )
      : [];
    const already = parseReminderIds(row.reminder_ids);
    if (!planReminders({ startsAt: row.starts_at, offsets, now, scheduled: already }).length) continue;
    try {
      const ctx = await loadBookingContext(admin, row.id, origin);
      if (ctx) scheduled += await scheduleReminders(admin, ctx, now);
    } catch (reminderError) {
      log("cron reminders failed", reminderError);
    }
  }
  return { checked: data?.length ?? 0, scheduled };
}

// ---------------------------------------------------------------------------
// Jarvis's bubble for the host
// ---------------------------------------------------------------------------

async function tellJarvis(admin: Admin, ctx: BookingContext) {
  const { booking } = ctx;
  if (!booking.host_user_id || !["pending", "confirmed"].includes(booking.status)) return;
  const type = booking.status === "pending" ? "bookingPending" : "bookingNew";
  const { error } = await admin.from("jarvis_suggestions").upsert(
    {
      user_id: booking.host_user_id,
      type,
      text: type === "bookingPending" ? "A booking waits for approval" : "A new booking",
      action: {
        kind: "open",
        href: bookingAppPath(booking.id),
        params: {
          guest: booking.guest_name ?? "",
          type: ctx.type?.name ?? "",
          startsAt: booking.starts_at,
        },
      } as unknown as Json,
      dedupe_key: `${type}:${booking.id}`,
    },
    { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
  );
  if (error) log("jarvis bubble failed", error);
}

// ---------------------------------------------------------------------------
// The public page: hold a time, book it
// ---------------------------------------------------------------------------

export type HoldInput = {
  handle: string;
  slug: string;
  start: number;
  guestTimeZone: string;
  clientHash: string;
  /** The visitor's previous hold, released by the new one. */
  release: string | null;
};

export async function holdSlot(
  admin: Admin,
  input: HoldInput,
  now = Date.now(),
): Promise<FlowResult<{ holdId: string; holdToken: string; expiresAt: string }>> {
  const profile = await loadPublicProfile(admin, input.handle);
  if (!profile) return { ok: false, problem: "notFound" };
  const host = await loadHostOfProfile(admin, profile);
  if (!host.available) return { ok: false, problem: "unavailable" };
  const row = await loadPublicTypeRow(admin, profile.id, input.slug);
  if (!row) return { ok: false, problem: "notFound" };

  // One of the type's free times now (the visitor's own previous hold not counted).
  const slots = await loadTypeSlots(
    admin,
    row,
    input.guestTimeZone,
    now,
    input.release ? { bookingId: input.release, calendarEventId: null } : undefined,
  );
  const free = slots.days.some((day) => day.slots.some((slot) => slot.start === input.start));
  if (!free) return { ok: false, problem: "slotTaken" };

  const token = newHoldToken();
  const { data, error } = await admin.rpc("scheduler_hold", {
    _type: row.id,
    _starts_at: new Date(input.start).toISOString(),
    _token_hash: bookingTokenHash(token),
    _client_hash: input.clientHash,
    _guest_time_zone: isValidTimeZone(input.guestTimeZone) ? input.guestTimeZone : profile.time_zone,
    ...(input.release ? { _release: input.release } : {}),
  });
  if (error) return { ok: false, problem: bookingProblem(error) };
  const result = data as { id: string; expires_at: string };
  await track("booking_held", {}, { userId: row.user_id, admin });
  return { ok: true, data: { holdId: result.id, holdToken: token, expiresAt: result.expires_at } };
}

export type BookInput = {
  holdId: string;
  holdToken: string;
  values: AnswerInput;
  locale: BookingLocale;
  timeZone: string;
  clientHash: string;
  origin: string;
};

export type BookResult = {
  status: "confirmed" | "pending";
  manageUrl: string;
  startsAt: string;
  endsAt: string;
  /** The meeting's video link, only for a confirmed booking. */
  videoLink: string | null;
  /** The UID of the e-mail's .ics, so "Add to calendar" on the page makes the same event. */
  icsUid: string;
};

export async function bookHold(
  admin: Admin,
  input: BookInput,
): Promise<FlowResult<BookResult> | { ok: false; problem: "invalid"; errors: Record<string, string> }> {
  if (!isBookingToken(input.holdToken)) return { ok: false, problem: "holdExpired" };
  const held = must(
    await admin
      .from("bookings")
      .select("id, status, event_type_id, host_user_id, space_id")
      .eq("id", input.holdId)
      .maybeSingle(),
  );
  if (!held || held.status !== "held" || !held.event_type_id) return { ok: false, problem: "holdExpired" };
  const typeRow = must(
    await admin.from("event_types").select(EVENT_TYPE_COLUMNS).eq("id", held.event_type_id).maybeSingle(),
  ) as EventTypeRow | null;
  if (!typeRow) return { ok: false, problem: "notFound" };
  const type = toEventType(typeRow);
  const profile = must(
    await admin.from("scheduler_profiles").select(PROFILE_COLUMNS).eq("id", type.profile_id).maybeSingle(),
  ) as SchedulerProfile | null;
  if (!profile) return { ok: false, problem: "notFound" };
  const host = await loadHostOfProfile(admin, profile);
  if (!host.available) return { ok: false, problem: "unavailable" };

  const zone = isValidTimeZone(input.timeZone) ? input.timeZone : profile.time_zone;
  const checked = checkAnswers(type.questions, input.values, countryFromTimeZone(zone) ?? host.country);
  if (!checked.ok) return { ok: false, problem: "invalid", errors: checked.errors };

  const { data, error } = await admin.rpc("scheduler_book", {
    _booking: held.id,
    _token_hash: bookingTokenHash(input.holdToken),
    _new_token_hash: bookingTokenHash(manageTokenFor(held.id, manageKey())),
    _name: checked.guest.name,
    _email: checked.guest.email,
    _phone: checked.guest.phone ?? "",
    _company: checked.guest.company ?? "",
    _time_zone: zone,
    _locale: input.locale,
    _answers: checked.answers as unknown as Json,
    _client_hash: input.clientHash,
  });
  if (error) return { ok: false, problem: bookingProblem(error) };
  const status = (data as { status: "confirmed" | "pending" }).status;

  const ctx = await loadBookingContext(admin, held.id, input.origin);
  if (!ctx) return { ok: false, problem: "unknown" };
  await effectsSafely(admin, ctx, status === "confirmed");
  if (status === "confirmed") {
    await mailSafely("guest confirmed", () => emailGuest(ctx, "confirmed", { ics: "CONFIRMED" }));
    await mailSafely("host booked", () => emailHost(ctx, "booked"));
    try {
      await scheduleReminders(admin, ctx);
    } catch (reminderError) {
      log("reminders failed", reminderError);
    }
  } else {
    await mailSafely("guest pending", () => emailGuest(ctx, "pending", { ics: "TENTATIVE" }));
    await mailSafely("host approval", () => emailHost(ctx, "approval"));
  }
  await tellJarvis(admin, ctx);
  await track(
    "booking_created",
    { status, duration: Math.min(480, type.duration_min) },
    { userId: ctx.booking.host_user_id, admin },
  );
  return {
    ok: true,
    data: {
      status,
      manageUrl: manageUrlOf(held.id, input.origin),
      startsAt: ctx.booking.starts_at,
      endsAt: ctx.booking.ends_at,
      videoLink:
        status === "confirmed" && type.location_kind === "video" ? (profile.video_link ?? null) : null,
      icsUid: icsUidOf(held.id),
    },
  };
}

// ---------------------------------------------------------------------------
// Decisions and changes
// ---------------------------------------------------------------------------

async function call(
  run: () => PromiseLike<{ error: unknown; data?: unknown }>,
): Promise<BookingProblem | null> {
  const { error } = await run();
  return error ? bookingProblem(error) : null;
}

/** The host approves a pending booking: the steps that waited now run. */
export async function approveBooking(
  admin: Admin,
  bookingId: string,
  origin: string,
): Promise<FlowResult<null>> {
  const problem = await call(() => admin.rpc("scheduler_confirm", { _booking: bookingId }));
  if (problem) return { ok: false, problem };
  const ctx = await loadBookingContext(admin, bookingId, origin);
  if (!ctx) return { ok: false, problem: "notFound" };
  await effectsSafely(admin, ctx, true);
  await mailSafely("guest approved", () => emailGuest(ctx, "approved", { ics: "CONFIRMED" }));
  try {
    await scheduleReminders(admin, ctx);
  } catch (error) {
    log("reminders failed", error);
  }
  await track("booking_confirmed", {}, { userId: ctx.booking.host_user_id, admin });
  return { ok: true, data: null };
}

/** The host declines a pending booking, with a reason and maybe another time to book. */
export async function declineBooking(
  admin: Admin,
  bookingId: string,
  reason: string | null,
  alternative: string | null,
  origin: string,
): Promise<FlowResult<null>> {
  const problem = await call(() =>
    admin.rpc("scheduler_decline", { _booking: bookingId, _reason: reason ?? "" }),
  );
  if (problem) return { ok: false, problem };
  const ctx = await loadBookingContext(admin, bookingId, origin);
  if (!ctx) return { ok: false, problem: "notFound" };
  await effectsSafely(admin, ctx, false);
  await cancelReminders(admin, ctx).catch((error) => log("reminders cancel failed", error));
  await mailSafely("guest declined", () =>
    emailGuest(ctx, "declined", { reason, alternative, ics: "CANCELLED" }),
  );
  await track("booking_declined", {}, { userId: ctx.booking.host_user_id, admin });
  return { ok: true, data: null };
}

/** The host or the guest cancels; the other side hears it (the guest always gets the .ics that drops it). */
export async function cancelBooking(
  admin: Admin,
  bookingId: string,
  by: "host" | "guest",
  reason: string | null,
  origin: string,
): Promise<FlowResult<null>> {
  const problem = await call(() =>
    admin.rpc("scheduler_cancel", { _booking: bookingId, _by: by, _reason: reason ?? "" }),
  );
  if (problem) return { ok: false, problem };
  const ctx = await loadBookingContext(admin, bookingId, origin);
  if (!ctx) return { ok: false, problem: "notFound" };
  await effectsSafely(admin, ctx, false);
  await cancelReminders(admin, ctx).catch((error) => log("reminders cancel failed", error));
  await mailSafely("guest cancelled", () =>
    emailGuest(ctx, by === "host" ? "cancelledByHost" : "cancelledByGuest", {
      reason: by === "host" ? reason : null,
      ics: "CANCELLED",
    }),
  );
  if (by === "guest") await mailSafely("host cancelled", () => emailHost(ctx, "cancelledByGuest", { reason }));
  await track("booking_cancelled", { by }, { userId: ctx.booking.host_user_id, admin });
  return { ok: true, data: null };
}

/** The free times a booking may move to (its own time and meeting not counted). */
export async function rescheduleSlots(admin: Admin, ctx: BookingContext, guestTimeZone: string) {
  if (!ctx.type) return null;
  const row = must(
    await admin.from("event_types").select(EVENT_TYPE_COLUMNS).eq("id", ctx.type.id).maybeSingle(),
  ) as EventTypeRow | null;
  if (!row) return null;
  return loadTypeSlots(admin, row, guestTimeZone, Date.now(), {
    bookingId: ctx.booking.id,
    calendarEventId: ctx.booking.calendar_event_id,
  });
}

/** Moves a booking to another of the type's free times; calendar, reminders and e-mails follow. */
export async function rescheduleBooking(
  admin: Admin,
  bookingId: string,
  start: number,
  by: "host" | "guest",
  origin: string,
): Promise<FlowResult<null>> {
  const before = await loadBookingContext(admin, bookingId, origin);
  if (!before) return { ok: false, problem: "notFound" };
  if (!before.host?.available) return { ok: false, problem: "unavailable" };
  const slots = await rescheduleSlots(admin, before, guestZone(before));
  if (!slots?.days.some((day) => day.slots.some((slot) => slot.start === start))) {
    return { ok: false, problem: "slotTaken" };
  }
  const problem = await call(() =>
    admin.rpc("scheduler_reschedule", {
      _booking: bookingId,
      _starts_at: new Date(start).toISOString(),
    }),
  );
  if (problem) return { ok: false, problem };
  const ctx = await loadBookingContext(admin, bookingId, origin);
  if (!ctx) return { ok: false, problem: "notFound" };
  await effectsSafely(admin, ctx, false);
  try {
    await cancelReminders(admin, ctx);
    await scheduleReminders(admin, ctx);
  } catch (error) {
    log("reminders failed", error);
  }
  const previousStartsAt = before.booking.starts_at;
  await mailSafely("guest rescheduled", () =>
    emailGuest(ctx, "rescheduled", {
      previousStartsAt,
      ics: ctx.booking.status === "confirmed" ? "CONFIRMED" : "TENTATIVE",
    }),
  );
  if (by === "guest") {
    await mailSafely("host rescheduled", () => emailHost(ctx, "rescheduledByGuest", { previousStartsAt }));
  }
  await track("booking_rescheduled", { by }, { userId: ctx.booking.host_user_id, admin });
  return { ok: true, data: null };
}

export async function setNoShow(
  admin: Admin,
  bookingId: string,
  noShow: boolean,
  userId: string,
): Promise<FlowResult<null>> {
  const problem = await call(() =>
    admin.rpc("scheduler_set_no_show", { _booking: bookingId, _no_show: noShow }),
  );
  if (problem) return { ok: false, problem };
  await track("booking_no_show", { no_show: noShow }, { userId, admin });
  return { ok: true, data: null };
}

export async function dismissSurvey(
  admin: Admin,
  bookingId: string,
  userId: string,
): Promise<FlowResult<null>> {
  const problem = await call(() =>
    admin.rpc("scheduler_dismiss_survey", { _booking: bookingId }),
  );
  if (problem) return { ok: false, problem };
  await track("booking_survey_dismissed", {}, { userId, admin });
  return { ok: true, data: null };
}

/** The booking as the guest's page shows it, by the link's token. */
export async function loadManagedBooking(admin: Admin, token: string, origin: string) {
  const id = await bookingIdByToken(admin, token);
  if (!id) return null;
  return loadBookingContext(admin, id, origin);
}
