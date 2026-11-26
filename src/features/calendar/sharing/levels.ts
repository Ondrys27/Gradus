import type { Tone } from "@/components/ui/tone";

/**
 * Calendar sharing inside a company (30.3), the rules the screens share with
 * the database (20261210090000_calendar_sharing.sql): the levels, the
 * sources of a calendar, the colours people get and which path a change of
 * someone else's event takes. No React and no Supabase here.
 */

export const SHARE_LEVELS = ["busy", "read", "write"] as const;
export type ShareLevel = (typeof SHARE_LEVELS)[number];

export const SHARE_TARGETS = ["member", "group", "space"] as const;
export type ShareTarget = (typeof SHARE_TARGETS)[number];

/** The Gradus calendar among a person's sources; the others are ids of their Google / Apple calendars. */
export const GRADUS_SOURCE = "gradus";

/** After a decline the same request waits this long (calendar_request_retry_days). */
export const REQUEST_RETRY_DAYS = 7;
export const REQUEST_MESSAGE_MAX = 500;

export function isShareLevel(value: unknown): value is ShareLevel {
  return typeof value === "string" && (SHARE_LEVELS as readonly string[]).includes(value);
}

/** calendar_level_rank(): busy 1, read 2, write 3, anything else 0. */
export function levelRank(level: string | null | undefined): number {
  return level ? SHARE_LEVELS.indexOf(level as ShareLevel) + 1 : 0;
}

export function atLeast(level: string | null | undefined, wanted: ShareLevel): boolean {
  return levelRank(level) >= levelRank(wanted);
}

/** The colours a person's calendar may have (never neutral: that is the subscriptions' grey). */
export const PERSON_TONES = [
  "teal",
  "gold",
  "green",
  "pink",
  "violet",
] as const satisfies readonly Tone[];
export type PersonTone = (typeof PERSON_TONES)[number];

export function isPersonTone(value: unknown): value is PersonTone {
  return typeof value === "string" && (PERSON_TONES as readonly string[]).includes(value);
}

/** A person's colour until the viewer picks one: steady for the same id. */
export function defaultPersonTone(personId: string): PersonTone {
  let hash = 0;
  for (const char of personId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PERSON_TONES[hash % PERSON_TONES.length];
}

/** Whose calendar an event is in (calendar_owner_id, else who made it, else the space). */
export function calendarOwnerOf(event: {
  calendar_owner_id?: string | null;
  actor_id?: string | null;
  user_id?: string | null;
}): string | null {
  return event.calendar_owner_id ?? event.actor_id ?? event.user_id ?? null;
}

/**
 * Which way a change of an event goes: through the table (the row's rules
 * let the account change it), through the share (write on the person's
 * calendar), or not at all.
 */
export function editPath(input: {
  /** canEditEvent() for the account, i.e. the row's rules allow it. */
  tableEditable: boolean;
  /** The event came from calendar_shared_events() and can_edit was set. */
  sharedEditable: boolean;
}): "table" | "share" | null {
  if (input.tableEditable) return "table";
  if (input.sharedEditable) return "share";
  return null;
}

export type VisiblePerson = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  isOwner: boolean;
  level: ShareLevel;
  sources: { key: string; name: string | null; level: ShareLevel }[];
  canWrite: boolean;
  /** Their Google / Apple calendar an event written into their calendar goes to too. */
  writesTo: string | null;
};

/** calendar_visible_people() rows, tolerant of anything odd in the jsonb. */
export function toVisiblePeople(
  rows: ReadonlyArray<{
    user_id: string;
    name: string | null;
    avatar_url: string | null;
    is_owner: boolean | null;
    level: string | null;
    sources: unknown;
    can_write: boolean | null;
    writes_to: string | null;
  }>,
): VisiblePerson[] {
  return rows.flatMap((row) => {
    if (!isShareLevel(row.level)) return [];
    const sources = Array.isArray(row.sources)
      ? row.sources.flatMap((source) => {
          if (!source || typeof source !== "object") return [];
          const { key, name, level } = source as Record<string, unknown>;
          return typeof key === "string" && isShareLevel(level)
            ? [{ key, name: typeof name === "string" ? name : null, level }]
            : [];
        })
      : [];
    return [
      {
        userId: row.user_id,
        name: row.name?.trim() || "",
        avatarUrl: row.avatar_url || null,
        isOwner: Boolean(row.is_owner),
        level: row.level,
        sources,
        canWrite: Boolean(row.can_write),
        writesTo: row.writes_to || null,
      },
    ];
  });
}

/** What a request may still ask for: levels above what the person already has. */
export function requestableLevels(current: ShareLevel | null): ShareLevel[] {
  return SHARE_LEVELS.filter((level) => levelRank(level) > levelRank(current));
}
