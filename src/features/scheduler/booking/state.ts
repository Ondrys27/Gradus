/**
 * The life of a booking (24.4), as the screens and the server read it; the
 * database functions (scheduler_hold, _book, _confirm, _decline, _cancel,
 * _reschedule, _set_no_show) enforce the same rules under a lock.
 *
 *   held ──answers──▶ confirmed            (the type books straight away)
 *        └─answers──▶ pending ──approve──▶ confirmed
 *                             └─decline──▶ declined
 *   pending | confirmed ──cancel (host or guest)──▶ cancelled
 *   pending | confirmed ──move──▶ the same status at another time
 *   confirmed, started ──▶ no-show (a mark, not a status)
 *
 * Everything ends with the meeting: once it is over nothing can be moved,
 * cancelled or approved, and the guest's link stops working.
 */

export const HOLD_MINUTES = 5;
/** A meeting this long ago is not asked about any more. */
export const SURVEY_DAYS = 14;

export type BookingLife = {
  status: string;
  starts_at: string;
  ends_at: string;
  hold_expires_at?: string | null;
  no_show_at?: string | null;
};

const isLive = (status: string) => status === "pending" || status === "confirmed";
const before = (iso: string, now: number) => Date.parse(iso) > now;

/** A hold still keeps its time. */
export function holdActive(booking: Pick<BookingLife, "status" | "hold_expires_at">, now: number) {
  return (
    booking.status === "held" &&
    Boolean(booking.hold_expires_at) &&
    Date.parse(booking.hold_expires_at!) > now
  );
}

/** Whole seconds left of a hold, never below zero (the countdown on the page). */
export function holdSecondsLeft(expiresAt: string | null, now: number): number {
  if (!expiresAt) return 0;
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
}

export function canApprove(booking: BookingLife, now: number): boolean {
  return booking.status === "pending" && before(booking.ends_at, now);
}

export function canDecline(booking: BookingLife, now: number): boolean {
  return booking.status === "pending" && before(booking.ends_at, now);
}

export function canCancel(booking: BookingLife, now: number): boolean {
  return isLive(booking.status) && before(booking.ends_at, now);
}

export function canReschedule(booking: BookingLife, now: number): boolean {
  return isLive(booking.status) && before(booking.ends_at, now);
}

/** The guest's link works for a live booking until its meeting ends. */
export function guestCanManage(booking: BookingLife, now: number): boolean {
  return isLive(booking.status) && before(booking.ends_at, now);
}

/** Only a confirmed meeting that has started can be a no-show. */
export function canMarkNoShow(booking: BookingLife, now: number): boolean {
  return booking.status === "confirmed" && !before(booking.starts_at, now);
}

/** What a list shows: the status, with a no-show and a finished meeting told apart. */
export type BookingLabel =
  | "held"
  | "pending"
  | "confirmed"
  | "done"
  | "noShow"
  | "cancelled"
  | "declined"
  | "rescheduled";

export function bookingLabel(booking: BookingLife, now: number): BookingLabel {
  if (booking.status === "confirmed") {
    if (booking.no_show_at) return "noShow";
    return before(booking.ends_at, now) ? "confirmed" : "done";
  }
  if (
    booking.status === "held" ||
    booking.status === "pending" ||
    booking.status === "cancelled" ||
    booking.status === "declined" ||
    booking.status === "rescheduled"
  ) {
    return booking.status;
  }
  return "cancelled";
}

/**
 * The meeting survey (the one asked when a deal leaves the meeting stage) is
 * offered for a booked meeting too: confirmed, over, not a no-show, within
 * two weeks, with a deal to file it under, not skipped and not answered yet.
 */
export function surveyDue(
  booking: BookingLife & { deal_id: string | null; survey_dismissed_at: string | null },
  answered: boolean,
  now: number,
): boolean {
  if (booking.status !== "confirmed" || booking.no_show_at || answered) return false;
  if (!booking.deal_id || booking.survey_dismissed_at) return false;
  const ended = Date.parse(booking.ends_at);
  return ended <= now && ended > now - SURVEY_DAYS * 86_400_000;
}

/** Codes the database raises, as the screens name them. */
export type BookingProblem =
  | "slotTaken"
  | "holdExpired"
  | "rateLimited"
  | "invalidState"
  | "notFound"
  | "invalid"
  | "readOnly"
  | "unavailable"
  | "forbidden"
  | "unknown";

export function bookingProblem(error: unknown): BookingProblem {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  if (/slot_taken/.test(message)) return "slotTaken";
  if (/hold_expired/.test(message)) return "holdExpired";
  if (/rate_limited/.test(message)) return "rateLimited";
  if (/invalid_state/.test(message)) return "invalidState";
  if (/not_found/.test(message)) return "notFound";
  if (/read_only/.test(message)) return "readOnly";
  if (/invalid/.test(message)) return "invalid";
  return "unknown";
}
