import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverCan } from "@/features/account/server/permissions";
import { moveContactToTable } from "@/features/contacts/ops";
import type { Answers } from "@/features/contacts/move-form";
import {
  FIELD_COLUMNS,
  MEETING_FIELD_KEY,
  TABLE_COLUMNS,
  type ContactField,
  type ContactTable,
} from "@/features/contacts/types";
import { isWorkspaceReadOnly } from "@/features/plan/server";
import { track } from "@/lib/analytics/track";
import type { OpsEnv } from "@/lib/ops";
import type { Database } from "@/types/database";
import type { BookingDialogSource } from "../analytics";
import { bookingProblem, type BookingProblem } from "../booking/state";
import { bookingTokenHash, isBookingToken, newHoldToken } from "../booking/tokens";
import {
  defaultTypeOf,
  guestNameOf,
  hostAllowed,
  parseMeetingSettings,
  planHosts,
  typeAllowed,
  type HostCandidate,
  type HostPlan,
  type MeetingSettings,
} from "../meeting-plan";
import { LIVE_CONFIRM_MAX_AGE_MS, LIVE_PAGE_MAX_AGE_MS } from "../remote-busy";
import { EVENT_TYPE_COLUMNS, type EventTypeRow, type LocationKind } from "../types";
import { isValidTimeZone } from "../zoned";
import { finishAppBooking, manageTokenHashOf, personName } from "./bookings";
import { isSlotFree, loadTypeSlots, type TypeSlots } from "./busy";

/**
 * A meeting booked in the app for a contact (30.4): from Cold Calling (the
 * move into "Meeting scheduled"), from a contact or a deal ("Schedule a
 * meeting"), and from Grady or a connected app as an operation. One path:
 *
 *   setup  — who may be the host (meeting-plan.ts), their types, the defaults
 *   slots  — the host's free and taken times by THEIR scheduler (the caller
 *            sees only free / full, never what is there)
 *   hold   — the picked time is held while the dialog is open (renewed)
 *   book   — confirmed at once (agreed on the phone), then the caller's move
 *            of the contact into "Meeting scheduled" (their reward and XP, as
 *            before), then everything a booking does (bookings.ts).
 *
 * The caller is always the session's (`db` is their own client, RLS
 * decides what they reach); the admin client only reads other people's
 * schedulers after the checks and runs the scheduler's functions.
 */

type Admin = SupabaseClient<Database>;
type UserDb = SupabaseClient<Database>;

export type Actor = { db: UserDb; userId: string; spaceId: string };

export type AppBookingProblem =
  | BookingProblem
  /** The time is taken or outside the hours: the app may book anyway. */
  | "busy"
  | "noHost"
  | "noContact"
  | "noEmail";

export type AppResult<T> =
  { ok: true; data: T } | { ok: false; problem: AppBookingProblem; details?: string };

export type HostOption = {
  userId: string;
  name: string;
  isSelf: boolean;
  timeZone: string;
  types: Array<{
    id: string;
    name: string;
    durationMin: number;
    locationKind: LocationKind;
    minNoticeHours: number;
  }>;
  defaultTypeId: string | null;
};

export type MeetingSetup = {
  hosts: HostOption[];
  defaultHost: string | null;
  canPickHost: boolean;
  missing: HostPlan["missing"];
  /** The caller may have a scheduler here (the one step of working hours). */
  canSetup: boolean;
  settings: MeetingSettings;
  contact: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    company: string | null;
    /** Where it is now (a system table's key), to tell whether booking moves it. */
    tableKey: string | null;
  };
};

const MAX_HOSTS = 100;

/** The caller may book a meeting for a contact here: they move contacts (contacts or Cold Calling). */
async function mayBook(actor: Actor): Promise<boolean> {
  if (actor.spaceId === actor.userId) return true;
  const [calls, contacts] = await Promise.all([
    serverCan(actor.db, actor.spaceId, "cold_calling", "call").catch(() => false),
    serverCan(actor.db, actor.spaceId, "contacts", "update").catch(() => false),
  ]);
  return calls || contacts;
}

async function canScheduleOthers(actor: Actor): Promise<boolean> {
  if (actor.spaceId === actor.userId) return true;
  return serverCan(actor.db, actor.spaceId, "cold_calling", "schedule_others").catch(() => false);
}

type Candidate = HostCandidate & {
  profileTimeZone: string;
  rows: EventTypeRow[];
};

/** Everyone of the space with a scheduler there who may still be booked, with their active types. */
async function loadCandidates(admin: Admin, spaceId: string): Promise<Candidate[]> {
  const { data: profiles, error } = await admin
    .from("scheduler_profiles")
    .select("id, user_id, time_zone")
    .eq("space_id", spaceId)
    .limit(MAX_HOSTS);
  if (error) throw error;
  if (!profiles?.length) return [];
  const { data: types, error: typesError } = await admin
    .from("event_types")
    .select(EVENT_TYPE_COLUMNS)
    .eq("space_id", spaceId)
    .eq("active", true)
    .in(
      "profile_id",
      profiles.map((profile) => profile.id),
    )
    .order("position")
    .limit(MAX_HOSTS * 20);
  if (typesError) throw typesError;
  const out: Candidate[] = [];
  for (const profile of profiles) {
    const { data: active } = await admin.rpc("scheduler_host_active", {
      _user: profile.user_id,
      _space: spaceId,
    });
    if (active !== true) continue;
    const rows = ((types ?? []) as EventTypeRow[]).filter((type) => type.profile_id === profile.id);
    out.push({
      userId: profile.user_id,
      profileTimeZone: profile.time_zone,
      rows,
      types: rows.map((row) => ({
        id: row.id,
        active: row.active,
        duration_min: row.duration_min,
        position: row.position,
      })),
    });
  }
  return out;
}

async function loadSettings(actor: Actor): Promise<MeetingSettings> {
  const { data, error } = await actor.db
    .from("cold_calling_meeting_settings")
    .select("host_mode, host_user_id, event_type_id, type_locked, ignore_notice")
    .eq("space_id", actor.spaceId)
    .maybeSingle();
  if (error) throw error;
  return parseMeetingSettings(data);
}

type Plan = { settings: MeetingSettings; plan: HostPlan; candidates: Candidate[] };

async function planFor(admin: Admin, actor: Actor): Promise<Plan> {
  const [settings, candidates, others] = await Promise.all([
    loadSettings(actor),
    loadCandidates(admin, actor.spaceId),
    canScheduleOthers(actor),
  ]);
  const plan = planHosts({
    settings,
    ownerId: actor.spaceId,
    callerId: actor.userId,
    canScheduleOthers: others,
    candidates,
  });
  return { settings, plan, candidates };
}

async function readContact(actor: Actor, contactId: string) {
  const { data, error } = await actor.db
    .from("contacts")
    .select("id, first_name, last_name, company_name, email, phone")
    .eq("user_id", actor.spaceId)
    .eq("id", contactId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function contactTableKey(actor: Actor, contactId: string): Promise<string | null> {
  const { data, error } = await actor.db
    .from("contact_table_entries")
    .select("table:contact_tables(system_key)")
    .eq("user_id", actor.spaceId)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (error) throw error;
  return (data?.table as { system_key: string | null } | null)?.system_key ?? null;
}

/** What the dialog starts from: hosts, their types, the defaults and the contact. */
export async function loadMeetingSetup(
  admin: Admin,
  actor: Actor,
  contactId: string,
): Promise<AppResult<MeetingSetup>> {
  if (!(await mayBook(actor))) return { ok: false, problem: "forbidden" };
  const contact = await readContact(actor, contactId);
  if (!contact) return { ok: false, problem: "noContact" };
  const [{ settings, plan, candidates }, tableKey, canSetup] = await Promise.all([
    planFor(admin, actor),
    contactTableKey(actor, contactId),
    actor.spaceId === actor.userId
      ? Promise.resolve(true)
      : serverCan(actor.db, actor.spaceId, "scheduler", "own").catch(() => false),
  ]);
  const byId = new Map(candidates.map((candidate) => [candidate.userId, candidate]));
  const hosts: HostOption[] = [];
  for (const userId of plan.hosts) {
    const candidate = byId.get(userId);
    if (!candidate) continue;
    hosts.push({
      userId,
      name: (await personName(admin, actor.spaceId, userId)) || "",
      isSelf: userId === actor.userId,
      timeZone: candidate.profileTimeZone,
      types: candidate.rows.map((row) => ({
        id: row.id,
        name: row.name,
        durationMin: row.duration_min,
        locationKind: row.location_kind as LocationKind,
        minNoticeHours: row.min_notice_hours,
      })),
      defaultTypeId: defaultTypeOf(candidate, settings),
    });
  }
  return {
    ok: true,
    data: {
      hosts,
      defaultHost: plan.defaultHost,
      canPickHost: plan.canPick,
      missing: plan.missing,
      canSetup,
      settings,
      contact: {
        id: contact.id,
        name: guestNameOf(contact),
        email: contact.email,
        phone: contact.phone,
        company: contact.company_name,
        tableKey,
      },
    },
  };
}

type Checked =
  | { ok: true; row: EventTypeRow; settings: MeetingSettings }
  | { ok: false; problem: AppBookingProblem };

/** The caller may book this host and this type now. */
async function checkHostAndType(
  admin: Admin,
  actor: Actor,
  hostId: string,
  typeId: string,
): Promise<Checked> {
  if (!(await mayBook(actor))) return { ok: false, problem: "forbidden" };
  const { settings, plan, candidates } = await planFor(admin, actor);
  if (!hostAllowed(plan, hostId)) return { ok: false, problem: "noHost" };
  const candidate = candidates.find((item) => item.userId === hostId);
  if (!typeAllowed(candidate, settings, typeId)) return { ok: false, problem: "forbidden" };
  const row = candidate!.rows.find((item) => item.id === typeId)!;
  return { ok: true, row, settings };
}

/** The host's free and taken times for the type, in the caller's zone. */
export async function loadAppSlots(
  admin: Admin,
  actor: Actor,
  input: { hostId: string; typeId: string; timeZone: string },
): Promise<AppResult<TypeSlots & { ignoreNotice: boolean }>> {
  const checked = await checkHostAndType(admin, actor, input.hostId, input.typeId);
  if (!checked.ok) return checked;
  // Holds that ran out free their times.
  await admin
    .from("bookings")
    .delete()
    .eq("host_user_id", input.hostId)
    .eq("status", "held")
    .lt("hold_expires_at", new Date().toISOString());
  const slots = await loadTypeSlots(
    admin,
    checked.row,
    isValidTimeZone(input.timeZone) ? input.timeZone : "Europe/Prague",
    Date.now(),
    undefined,
    {
      withBusy: true,
      ignoreNotice: checked.settings.ignoreNotice,
      liveMaxAgeMs: LIVE_PAGE_MAX_AGE_MS,
    },
  );
  return { ok: true, data: { ...slots, ignoreNotice: checked.settings.ignoreNotice } };
}

export type AppHold = { holdId: string; holdToken: string; expiresAt: string };

/**
 * Holds a time for the open dialog. Without `force` only one of the host's
 * free times (read fresh); with it ("Book anyway") any future time that no
 * other booking starts at.
 */
export async function holdForApp(
  admin: Admin,
  actor: Actor,
  input: {
    hostId: string;
    typeId: string;
    start: number;
    force: boolean;
    release: string | null;
    source: "cold_calling" | "app";
  },
): Promise<AppResult<AppHold>> {
  if (await isWorkspaceReadOnly(admin, actor.spaceId)) return { ok: false, problem: "readOnly" };
  const checked = await checkHostAndType(admin, actor, input.hostId, input.typeId);
  if (!checked.ok) return checked;
  if (!Number.isSafeInteger(input.start) || input.start <= Date.now()) {
    return { ok: false, problem: "invalid" };
  }
  if (
    !input.force &&
    !(await isSlotFree(admin, checked.row, input.start, {
      ignoreNotice: checked.settings.ignoreNotice,
      liveMaxAgeMs: LIVE_CONFIRM_MAX_AGE_MS,
      ...(input.release ? { exclude: { bookingId: input.release, calendarEventId: null } } : {}),
    }))
  ) {
    return { ok: false, problem: "busy" };
  }
  const token = newHoldToken();
  const { data, error } = await admin.rpc("scheduler_hold_app", {
    _type: checked.row.id,
    _starts_at: new Date(input.start).toISOString(),
    _token_hash: bookingTokenHash(token),
    _actor: actor.userId,
    _source: input.source,
    _force: input.force,
    ...(input.release ? { _release: input.release } : {}),
  });
  if (error) {
    const problem = bookingProblem(error);
    return { ok: false, problem: problem === "slotTaken" && !input.force ? "busy" : problem };
  }
  const result = data as { id: string; expires_at: string };
  return { ok: true, data: { holdId: result.id, holdToken: token, expiresAt: result.expires_at } };
}

/** Five more minutes while the dialog stays open. */
export async function extendAppHold(
  admin: Admin,
  actor: Actor,
  input: { holdId: string; holdToken: string },
): Promise<AppResult<{ expiresAt: string }>> {
  if (!isBookingToken(input.holdToken)) return { ok: false, problem: "holdExpired" };
  const { data: hold } = await admin
    .from("bookings")
    .select("created_by")
    .eq("id", input.holdId)
    .maybeSingle();
  if (!hold || hold.created_by !== actor.userId) return { ok: false, problem: "holdExpired" };
  const { data, error } = await admin.rpc("scheduler_hold_extend", {
    _booking: input.holdId,
    _token_hash: bookingTokenHash(input.holdToken),
  });
  if (error) return { ok: false, problem: bookingProblem(error) };
  return { ok: true, data: { expiresAt: String(data) } };
}

/** The dialog closed: its hold frees the time at once. */
export async function releaseAppHold(
  admin: Admin,
  actor: Actor,
  input: { holdId: string; holdToken: string },
): Promise<void> {
  if (!isBookingToken(input.holdToken)) return;
  await admin
    .from("bookings")
    .delete()
    .eq("id", input.holdId)
    .eq("status", "held")
    .eq("created_by", actor.userId)
    .eq("manage_token_hash", bookingTokenHash(input.holdToken));
}

export type BookForContactInput = {
  holdId: string;
  holdToken: string;
  contactId: string;
  dealId: string | null;
  /** The guest gets the confirmation with the invite (needs an address). */
  sendEmail: boolean;
  /** An address typed in the dialog for a contact without one. */
  email: string | null;
  /** Answers to the other questions of "Meeting scheduled", by question id. */
  answers: Answers;
  /** "Book anyway": the time was taken when it was held. */
  forced: boolean;
  from: BookingDialogSource | "grady";
  locale: string;
  timeZone: string;
  origin: string;
};

export type BookForContactResult = {
  bookingId: string;
  startsAt: string;
  endsAt: string;
  emailed: boolean;
  /** The contact moved into "Meeting scheduled" (XP and the reward of the move). */
  moved: boolean;
  calendarEventId: string | null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function meetingTable(
  actor: Actor,
): Promise<{ table: ContactTable; fields: ContactField[] } | null> {
  const { data: table, error } = await actor.db
    .from("contact_tables")
    .select(TABLE_COLUMNS)
    .eq("user_id", actor.spaceId)
    .eq("system_key", "meeting_scheduled")
    .maybeSingle();
  if (error) throw error;
  if (!table) return null;
  const { data: fields, error: fieldsError } = await actor.db
    .from("contact_table_fields")
    .select(FIELD_COLUMNS)
    .eq("table_id", table.id)
    .limit(100);
  if (fieldsError) throw fieldsError;
  return { table, fields: (fields ?? []) as ContactField[] };
}

/**
 * Books the held time for the contact: the hold must be the caller's and
 * still theirs, the host and type still allowed, the contact theirs to see.
 * Without "Book anyway" the time is checked once more.
 */
export async function bookForContact(
  admin: Admin,
  actor: Actor,
  input: BookForContactInput,
): Promise<AppResult<BookForContactResult>> {
  if (!isBookingToken(input.holdToken)) return { ok: false, problem: "holdExpired" };
  if (await isWorkspaceReadOnly(admin, actor.spaceId)) return { ok: false, problem: "readOnly" };
  const { data: hold, error: holdError } = await admin
    .from("bookings")
    .select(
      "id, status, event_type_id, host_user_id, space_id, starts_at, created_by, source, hold_expires_at",
    )
    .eq("id", input.holdId)
    .maybeSingle();
  if (holdError) throw holdError;
  if (
    !hold ||
    hold.status !== "held" ||
    hold.created_by !== actor.userId ||
    hold.space_id !== actor.spaceId ||
    !hold.event_type_id ||
    !hold.host_user_id
  ) {
    return { ok: false, problem: "holdExpired" };
  }
  const checked = await checkHostAndType(admin, actor, hold.host_user_id, hold.event_type_id);
  if (!checked.ok) return checked;

  const contact = await readContact(actor, input.contactId);
  if (!contact) return { ok: false, problem: "noContact" };
  if (input.dealId) {
    const { data: deal } = await actor.db
      .from("deals")
      .select("id")
      .eq("user_id", actor.spaceId)
      .eq("id", input.dealId)
      .maybeSingle();
    if (!deal) return { ok: false, problem: "notFound" };
  }

  let email: string | null = null;
  if (input.sendEmail) {
    email = (input.email?.trim() || contact.email?.trim() || "").toLowerCase() || null;
    if (!email || !EMAIL.test(email) || email.length > 254)
      return { ok: false, problem: "noEmail" };
  }

  const start = Date.parse(hold.starts_at);
  if (
    !input.forced &&
    !(await isSlotFree(admin, checked.row, start, {
      exclude: { bookingId: hold.id, calendarEventId: null },
      ignoreNotice: checked.settings.ignoreNotice,
      liveMaxAgeMs: LIVE_CONFIRM_MAX_AGE_MS,
    }))
  ) {
    return { ok: false, problem: "busy" };
  }

  const name = guestNameOf(contact) || email || "—";
  const { error } = await admin.rpc("scheduler_book_app", {
    _booking: hold.id,
    _token_hash: bookingTokenHash(input.holdToken),
    _new_token_hash: manageTokenHashOf(hold.id),
    _name: name,
    _email: email ?? "",
    _phone: contact.phone ?? "",
    _company: contact.company_name ?? "",
    _time_zone: isValidTimeZone(input.timeZone) ? input.timeZone : "Europe/Prague",
    _locale: input.locale === "en" ? "en" : "cs",
    _contact: contact.id,
    ...(input.dealId ? { _deal: input.dealId } : {}),
  } as Database["public"]["Functions"]["scheduler_book_app"]["Args"]);
  if (error) return { ok: false, problem: bookingProblem(error) };

  // A typed address the contact did not have stays with the contact (when the caller may change it).
  if (email && !contact.email) {
    await actor.db
      .from("contacts")
      .update({ email })
      .eq("user_id", actor.spaceId)
      .eq("id", contact.id)
      .then(({ error: updateError }) => {
        if (updateError) console.error("[scheduler] contact e-mail not saved", updateError.code);
      });
  }

  // The caller's move into "Meeting scheduled": their reward and XP, as before 30.4.
  let moved = false;
  try {
    const current = await contactTableKey(actor, contact.id);
    const target = await meetingTable(actor);
    if (target && current !== "meeting_scheduled" && current !== "clients") {
      const meetingField = target.fields.find((field) => field.system_key === MEETING_FIELD_KEY);
      const answers: Answers = {
        ...input.answers,
        ...(meetingField ? { [meetingField.id]: new Date(start).toISOString() } : {}),
      };
      const env: OpsEnv = {
        db: actor.db,
        track: (event, props) => {
          void track(event, props, { userId: actor.userId, admin });
        },
      };
      const { data: fromTable } = await actor.db
        .from("contact_table_entries")
        .select("table:contact_tables(system_key)")
        .eq("user_id", actor.spaceId)
        .eq("contact_id", contact.id)
        .maybeSingle();
      await moveContactToTable(env, {
        contactId: contact.id,
        from: (fromTable?.table as { system_key: string | null } | null) ?? null,
        table: target.table,
        fields: target.fields,
        answers,
      });
      moved = true;
    }
  } catch (moveError) {
    // The answers were refused: nothing is booked, the dialog shows the question.
    await admin.from("bookings").delete().eq("id", hold.id);
    const { message, details } = (moveError ?? {}) as { message?: string; details?: string };
    console.error("[scheduler] app booking move failed", message ?? "unknown");
    return {
      ok: false,
      problem: "invalid",
      ...(details
        ? { details: `${message?.includes("answer_required") ? "required" : "invalid"}:${details}` }
        : {}),
    };
  }

  const { emailed, ctx } = await finishAppBooking(admin, hold.id, input.origin, {
    emailGuest: Boolean(email),
  });
  await track(
    "booking_from_app",
    {
      from: input.from,
      host: hold.host_user_id === actor.userId ? "self" : "other",
      forced: input.forced,
      emailed,
      moved,
    },
    { userId: actor.userId, admin },
  );
  return {
    ok: true,
    data: {
      bookingId: hold.id,
      startsAt: ctx?.booking.starts_at ?? hold.starts_at,
      endsAt: ctx?.booking.ends_at ?? hold.starts_at,
      emailed,
      moved,
      calendarEventId: ctx?.booking.calendar_event_id ?? null,
    },
  };
}

/**
 * One call for Grady and connected apps (no dialog to hold a time while it
 * is open): hold and book at once. `start` must be one of the host's free
 * times unless `force`.
 */
export async function scheduleMeetingNow(
  admin: Admin,
  actor: Actor,
  input: Omit<BookForContactInput, "holdId" | "holdToken" | "forced"> & {
    hostId: string;
    typeId: string;
    start: number;
    force: boolean;
  },
): Promise<AppResult<BookForContactResult>> {
  const hold = await holdForApp(admin, actor, {
    hostId: input.hostId,
    typeId: input.typeId,
    start: input.start,
    force: input.force,
    release: null,
    source: "app",
  });
  if (!hold.ok) return hold;
  const result = await bookForContact(admin, actor, {
    ...input,
    holdId: hold.data.holdId,
    holdToken: hold.data.holdToken,
    forced: input.force,
  });
  if (!result.ok) await releaseAppHold(admin, actor, hold.data);
  return result;
}

/**
 * A deal made right after the booking (the offer of Cold Calling) takes its
 * meeting: the booking and its event name the deal. Only the booking's
 * caller or host, only a deal of the booking's contact that they can see,
 * only while the booking has no deal yet.
 */
export async function attachDealToBooking(
  admin: Admin,
  actor: Actor,
  input: { bookingId: string; dealId: string },
): Promise<AppResult<null>> {
  const { data: booking, error } = await admin
    .from("bookings")
    .select(
      "id, space_id, contact_id, deal_id, created_by, host_user_id, calendar_event_id, status",
    )
    .eq("id", input.bookingId)
    .maybeSingle();
  if (error) throw error;
  if (
    !booking ||
    booking.space_id !== actor.spaceId ||
    (booking.created_by !== actor.userId && booking.host_user_id !== actor.userId) ||
    !["pending", "confirmed"].includes(booking.status)
  ) {
    return { ok: false, problem: "notFound" };
  }
  if (booking.deal_id) return { ok: true, data: null };
  const { data: deal } = await actor.db
    .from("deals")
    .select("id, contact_id")
    .eq("user_id", actor.spaceId)
    .eq("id", input.dealId)
    .maybeSingle();
  if (!deal || deal.contact_id !== booking.contact_id) return { ok: false, problem: "notFound" };
  const { error: updateError } = await admin
    .from("bookings")
    .update({ deal_id: deal.id })
    .eq("id", booking.id)
    .is("deal_id", null);
  if (updateError) throw updateError;
  if (booking.calendar_event_id) {
    const { error: eventError } = await admin
      .from("calendar_events")
      .update({ deal_id: deal.id })
      .eq("id", booking.calendar_event_id)
      .eq("user_id", actor.spaceId)
      .is("deal_id", null);
    if (eventError) throw eventError;
  }
  return { ok: true, data: null };
}
