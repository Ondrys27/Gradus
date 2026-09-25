import { instantToZonedParts, zonedWallClockToInstant, type IsoDate } from "@/lib/format";
import { DEFAULT_DURATION_MIN, eventKind, toEventItem } from "./calendar-logic";
import { eventSchema, type CalendarErrorKey, type EventInput } from "./schemas";
import type { CalendarEvent, EventContact, EventKind } from "./types";

export type EventDraft = {
  title: string;
  kind: EventKind;
  allDay: boolean;
  /** ISO instants (timed events). */
  startsAt: string | null;
  endsAt: string | null;
  /** Calendar days (all-day events). */
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  description: string;
  contact: EventContact | null;
  dealId: string | null;
};

const HOUR_MS = DEFAULT_DURATION_MIN * 60_000;

/** A blank draft, optionally on a given range (tapping or dragging the axis). */
export function emptyDraft(
  day: IsoDate,
  timeZone: string,
  range?: { starts_at: string; ends_at: string },
): EventDraft {
  const startsAt =
    range?.starts_at ?? zonedWallClockToInstant(day, "09:00", timeZone).toISOString();
  const endsAt = range?.ends_at ?? new Date(new Date(startsAt).getTime() + HOUR_MS).toISOString();
  return {
    title: "",
    kind: "meeting",
    allDay: false,
    startsAt,
    endsAt,
    startDate: instantToZonedParts(new Date(startsAt), timeZone).date,
    endDate: null,
    description: "",
    contact: null,
    dealId: null,
  };
}

export function draftFromEvent(event: CalendarEvent, timeZone: string): EventDraft {
  const item = toEventItem(event, timeZone);
  return {
    title: event.title,
    kind: eventKind(event.kind),
    allDay: event.all_day,
    startsAt: event.starts_at,
    endsAt: item.allDay ? null : new Date(item.endMs).toISOString(),
    startDate: item.firstDay,
    endDate: item.lastDay > item.firstDay ? item.lastDay : null,
    description: event.description ?? "",
    contact: event.contact,
    dealId: event.deal_id,
  };
}

/** Switching the all-day switch carries the day over so nothing has to be picked twice. */
export function withAllDay(draft: EventDraft, allDay: boolean, timeZone: string): EventDraft {
  if (allDay === draft.allDay) return draft;
  if (allDay) {
    const start = draft.startsAt
      ? instantToZonedParts(new Date(draft.startsAt), timeZone).date
      : null;
    const end = draft.endsAt ? instantToZonedParts(new Date(draft.endsAt), timeZone).date : null;
    return {
      ...draft,
      allDay,
      startDate: start,
      endDate: end && start && end > start ? end : null,
    };
  }
  const startsAt = draft.startDate
    ? zonedWallClockToInstant(draft.startDate, "09:00", timeZone).toISOString()
    : null;
  return {
    ...draft,
    allDay,
    startsAt,
    endsAt: startsAt ? new Date(new Date(startsAt).getTime() + HOUR_MS).toISOString() : null,
  };
}

export type DraftResult =
  { ok: true; data: EventInput } | { ok: false; errors: Partial<Record<string, CalendarErrorKey>> };

export function validateDraft(draft: EventDraft, timeZone: string): DraftResult {
  const startsAt = draft.allDay
    ? draft.startDate
      ? zonedWallClockToInstant(draft.startDate, "00:00", timeZone).toISOString()
      : ""
    : (draft.startsAt ?? "");
  const endsAt = draft.allDay
    ? draft.endDate
      ? zonedWallClockToInstant(draft.endDate, "00:00", timeZone).toISOString()
      : null
    : draft.endsAt;

  const result = eventSchema.safeParse({
    title: draft.title,
    kind: draft.kind,
    starts_at: startsAt,
    ends_at: endsAt,
    all_day: draft.allDay,
    description: draft.description,
    contact_id: draft.contact?.id ?? null,
    deal_id: draft.dealId,
  });
  if (result.success) return { ok: true, data: result.data };

  const errors: Partial<Record<string, CalendarErrorKey>> = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0]);
    errors[field] ??= issue.message as CalendarErrorKey;
  }
  return { ok: false, errors };
}
