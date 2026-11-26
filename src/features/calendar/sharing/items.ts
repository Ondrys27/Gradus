import { initialsOf } from "@/components/ui/avatar";
import { instantToZonedParts } from "@/lib/format";
import { toEventItem } from "../calendar-logic";
import type { BusyCalendarItem, CalendarEvent, CalendarItem, EventItem } from "../types";
import { calendarOwnerOf, defaultPersonTone, type PersonTone } from "./levels";

/**
 * Others' calendars on the account's calendar (30.3): their events in their
 * colour with their initials, busy-only ones as hatched "Busy" blocks. Pure,
 * so the rules are tested without a screen.
 */

/** The row calendar_shared_events() returns, as the screens read it (see queries.ts). */
export type SharedEventRow = {
  id: string;
  personId: string;
  level: "busy" | "read" | "write" | "invite";
  busyOnly: boolean;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  title: string | null;
  description: string | null;
  location: string | null;
  kind: string | null;
  source: string | null;
  createdBy: string | null;
  createdByName: string | null;
  canEdit: boolean;
  inviteStatus: "invited" | "accepted" | "declined" | null;
};

export type PersonLook = { id: string; name: string; tone: PersonTone; hidden: boolean };

/** The look of each person: the viewer's colour or the default, and the checkbox. */
export function personLooks(
  people: ReadonlyArray<{ userId: string; name: string }>,
  prefs: ReadonlyMap<string, { tone: PersonTone; hidden: boolean }> | undefined,
): Map<string, PersonLook> {
  const map = new Map<string, PersonLook>();
  for (const person of people) {
    const pref = prefs?.get(person.userId);
    map.set(person.userId, {
      id: person.userId,
      name: person.name,
      tone: pref?.tone ?? defaultPersonTone(person.userId),
      hidden: pref?.hidden ?? false,
    });
  }
  return map;
}

function personOf(look: PersonLook) {
  return { id: look.id, initials: initialsOf(look.name) || "?", name: look.name };
}

const KINDS = new Set(["meeting", "call", "reminder", "other", "task", "deadline"]);

/** A shared row the account may read in full, as an event of the calendar. */
export function sharedToEvent(row: SharedEventRow): CalendarEvent {
  return {
    id: row.id,
    title: row.title ?? "",
    description: row.description,
    kind: (row.kind && KINDS.has(row.kind) ? row.kind : "meeting") as CalendarEvent["kind"],
    starts_at: row.startsAt,
    ends_at: row.endsAt,
    all_day: row.allDay,
    contact_id: null,
    deal_id: null,
    source: row.source ?? "manual",
    actor_id: row.createdBy,
    calendar_owner_id: row.personId,
    contact: null,
    deal: null,
    shared: {
      personId: row.personId,
      level: row.level,
      createdByName: row.createdByName,
      canEdit: row.canEdit,
      inviteStatus: row.inviteStatus,
      location: row.location,
    },
  };
}

const MINUTE = 60_000;

/**
 * Others' events for the shown days: what the account already reads itself
 * (`ownIds`) is left out, hidden people are left out, a declined invite too.
 * `busyLabel` is the title of a busy-only block ("Busy").
 */
export function sharedItems(
  rows: readonly SharedEventRow[],
  looks: ReadonlyMap<string, PersonLook>,
  ownIds: ReadonlySet<string>,
  timeZone: string,
  busyLabel: string,
): CalendarItem[] {
  const out: CalendarItem[] = [];
  for (const row of rows) {
    if (ownIds.has(row.id)) continue;
    if (row.level === "invite") {
      if (row.inviteStatus === "declined") continue;
      const item = toEventItem(sharedToEvent(row), timeZone);
      out.push({ ...item, key: `invite:${row.id}` });
      continue;
    }
    const look = looks.get(row.personId);
    if (!look || look.hidden) continue;
    if (!row.busyOnly) {
      const item: EventItem = toEventItem(sharedToEvent(row), timeZone);
      out.push({ ...item, key: `shared:${row.id}`, tone: look.tone, person: personOf(look) });
      continue;
    }
    const startMs = Date.parse(row.startsAt);
    const endMs = row.endsAt ? Date.parse(row.endsAt) : startMs + 60 * MINUTE;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    const first = instantToZonedParts(new Date(startMs), timeZone).date;
    const last = endMs > startMs ? instantToZonedParts(new Date(endMs - 1), timeZone).date : first;
    const busy: BusyCalendarItem = {
      type: "busy",
      key: `shared:${row.id}`,
      title: busyLabel,
      tone: look.tone,
      allDay: row.allDay,
      firstDay: first,
      lastDay: last < first ? first : last,
      subscriptionId: `person:${row.personId}`,
      startMs,
      endMs: Math.max(endMs, startMs),
      person: personOf(look),
    };
    out.push(busy);
  }
  return out;
}

/**
 * The account's own events of the space, with the colour and initials of
 * whose calendar they are in when it is someone else's (the owner reads their
 * people's events anyway). A hidden person's events go too.
 */
export function ownEventLook(
  item: EventItem,
  me: string,
  looks: ReadonlyMap<string, PersonLook>,
): EventItem | null {
  const owner = calendarOwnerOf(item.event);
  if (!owner || owner === me) return item;
  const look = looks.get(owner);
  if (!look) return item;
  if (look.hidden) return null;
  return { ...item, tone: look.tone, person: personOf(look) };
}
