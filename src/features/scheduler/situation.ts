import { formatDate, formatTime, type FormatSettings } from "@/lib/format";

/** The scheduler in Grady's summary of the situation (24.3). */
export type SchedulerSituation = {
  upcoming: { startsAt: Date; guest: string; type: string | null; pending: boolean }[];
  upcomingTotal: number;
  /** Bookings waiting for the person's approval, from now on. */
  pendingTotal: number;
  /** The link to send for a first call; null without an active meeting type. */
  link: { name: string; durationMin: number; url: string } | null;
};

const MAX_TEXT = 60;
const quoted = (value: string) => {
  const flat = value.replace(/\s+/g, " ").trim();
  return JSON.stringify(flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT - 1)}…` : flat);
};

/** Lines for the model; nothing when the person has no scheduler. */
export function describeScheduler(
  scheduler: SchedulerSituation,
  settings: FormatSettings,
): string[] {
  const lines: string[] = [];
  if (scheduler.upcomingTotal) {
    const items = scheduler.upcoming.map(
      (booking) =>
        `${formatDate(booking.startsAt, settings)} ${formatTime(booking.startsAt, settings)} ${quoted(booking.guest)}${
          booking.type ? ` (${quoted(booking.type)})` : ""
        }${booking.pending ? " waiting for approval" : ""}`,
    );
    const more =
      scheduler.upcomingTotal > items.length
        ? ` (+${scheduler.upcomingTotal - items.length} more)`
        : "";
    lines.push(`Booked meetings in the next 7 days (Scheduler): ${items.join("; ")}${more}.`);
  } else {
    lines.push("Booked meetings in the next 7 days (Scheduler): none.");
  }
  if (scheduler.pendingTotal) {
    lines.push(
      `Bookings waiting for the user's approval: ${scheduler.pendingTotal} (Scheduler → Bookings, or Waiting for you on the dashboard).`,
    );
  }
  if (scheduler.link) {
    lines.push(
      `The user's booking link for a first call (${quoted(scheduler.link.name)}, ${scheduler.link.durationMin} min): ${scheduler.link.url}. When a contact should get a call or a meeting (contacts to follow up, a reply arranging a meeting), suggest sending this link so they pick a free time themselves.`,
    );
  }
  return lines;
}
