import type { LocationKind } from "../types";

/**
 * The call's link of a booked video meeting (27.5), the same on the server
 * (the booking's page, the host's calendar, the e-mails) and in the app (the
 * booking's detail). The guest's e-mails, the .ics and the reminders carry
 * only the booking's page (/s/r/<token>); the page asks this when it is
 * opened, so a link the host changes reaches invitations already sent.
 *
 * In this order:
 *   1. the host's own link for this one meeting (`bookings.meeting_link`),
 *   2. the booking's own room on Jitsi Meet when its type asks for one
 *      (`event_types.video_source = 'jitsi'`, `bookings.video_room`),
 *   3. the permanent link of the host's booking page (`scheduler_profiles.video_link`),
 *   4. none: "the host sends the link before the meeting" (and a task for them).
 */

export const VIDEO_SOURCES = ["profile", "jitsi"] as const;
export type VideoSource = (typeof VIDEO_SOURCES)[number];

export const JITSI_ORIGIN = "https://meet.jit.si";
/** What the database makes (`scheduler_new_room()`): 12 of 32 letters, no l, o, 0, 1. */
export const JITSI_ROOM = /^gradus-[a-km-np-z2-9]{12}$/;

export const MEETING_LINK_SOURCES = ["own", "room", "profile", "none"] as const;
export type MeetingLinkSource = (typeof MEETING_LINK_SOURCES)[number];
export type MeetingLink = { source: MeetingLinkSource; url: string | null };

/** The same rule as `scheduler_profiles.video_link` and `bookings.meeting_link`. */
export const MEETING_LINK_MAX = 500;
const LINK_SHAPE = /^https:\/\/[^\s/?#]+\.[^\s]+$/;

/** A link the scheduler accepts: https with a host (Meet, Teams, Zoom, Jitsi, any other). */
export function meetingLinkProblem(value: string): "format" | null {
  const link = value.trim();
  if (!link) return null;
  if (link.length > MEETING_LINK_MAX || !LINK_SHAPE.test(link)) return "format";
  return null;
}

export function isVideoSource(value: unknown): value is VideoSource {
  return typeof value === "string" && (VIDEO_SOURCES as readonly string[]).includes(value);
}

/** The room's address on meet.jit.si; null for anything that is not one of ours. */
export function jitsiUrl(room: string | null | undefined): string | null {
  return room && JITSI_ROOM.test(room) ? `${JITSI_ORIGIN}/${room}` : null;
}

/** The link the meeting uses now; null for a meeting that is not a video call. */
export function meetingLinkOf(input: {
  locationKind: LocationKind | string | null | undefined;
  videoSource: VideoSource | string | null | undefined;
  /** The host's own link of this meeting. */
  own: string | null | undefined;
  room: string | null | undefined;
  profileLink: string | null | undefined;
}): MeetingLink | null {
  if ((input.locationKind ?? "video") !== "video") return null;
  const own = input.own?.trim();
  if (own && !meetingLinkProblem(own)) return { source: "own", url: own };
  if (input.videoSource === "jitsi") {
    const room = jitsiUrl(input.room);
    if (room) return { source: "room", url: room };
  }
  const profile = input.profileLink?.trim();
  if (profile && !meetingLinkProblem(profile)) return { source: "profile", url: profile };
  return { source: "none", url: null };
}

/**
 * A video type that would book meetings without any link: the type uses the
 * permanent link and the booking page has none. The editor warns, the
 * booking says the host sends it and the host gets a task.
 */
export function typeLacksLink(type: {
  location_kind: string;
  video_source: string | null | undefined;
  profileLink: string | null | undefined;
}): boolean {
  return (
    type.location_kind === "video" &&
    type.video_source !== "jitsi" &&
    !(type.profileLink?.trim() && !meetingLinkProblem(type.profileLink))
  );
}

/** "Join" lights up this long before the start. */
export const JOIN_SOON_MINUTES = 15;

/** Where a confirmed meeting is in time, for its page: before, about to start or on, over. */
export type JoinPhase = "later" | "soon" | "over";

export function joinPhase(startsAt: string, endsAt: string, now: number): JoinPhase {
  if (Date.parse(endsAt) <= now) return "over";
  if (Date.parse(startsAt) - JOIN_SOON_MINUTES * 60_000 <= now) return "soon";
  return "later";
}

/** The next moment the phase changes (the page re-renders then), or null once over. */
export function nextPhaseAt(startsAt: string, endsAt: string, now: number): number | null {
  const soon = Date.parse(startsAt) - JOIN_SOON_MINUTES * 60_000;
  const end = Date.parse(endsAt);
  if (now < soon) return soon;
  if (now < end) return end;
  return null;
}

/** The guest hears of a changed link only while it is worth it: more than an hour before the start. */
export const LINK_MAIL_MIN_MINUTES = 60;

export function linkChangeMailDue(input: {
  status: string;
  startsAt: string;
  previous: string | null;
  next: string | null;
  now: number;
}): boolean {
  if (input.status !== "confirmed") return false;
  if ((input.previous ?? null) === (input.next ?? null)) return false;
  return Date.parse(input.startsAt) - input.now > LINK_MAIL_MIN_MINUTES * 60_000;
}

/** When the host's "send the link" task is due: an hour before the start, never in the past. */
export function linkTaskDue(startsAt: string, now: number): string {
  const due = Math.max(Date.parse(startsAt) - 60 * 60_000, now);
  // Whole minutes, like every task's time.
  return new Date(Math.ceil(due / 60_000) * 60_000).toISOString();
}
