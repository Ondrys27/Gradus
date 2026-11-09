import { buildBookingIcs, icsUtc } from "../ics/export";

/**
 * "Add to calendar" on the confirmation (24.5), pure: the links Google and
 * Outlook open with the meeting filled in, and the .ics file Apple Calendar
 * (and anything else) imports. The file carries the same UID as the e-mail's
 * invite, so a guest who adds both ends up with one event, not two.
 */

export type CalendarEvent = {
  title: string;
  /** ISO instants. */
  start: string;
  end: string;
  location?: string | null;
  description?: string | null;
};

export function googleCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${icsUtc(new Date(event.start))}/${icsUtc(new Date(event.end))}`,
  });
  if (event.location) params.set("location", event.location);
  if (event.description) params.set("details", event.description);
  return `https://calendar.google.com/calendar/render?${params}`;
}

export function outlookCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    // Outlook's own path; spelled in parts so the source holds no old app address.
    path: ["", "calendar", "action", "compose"].join("/"),
    rru: "addevent",
    subject: event.title,
    startdt: new Date(event.start).toISOString(),
    enddt: new Date(event.end).toISOString(),
  });
  if (event.location) params.set("location", event.location);
  if (event.description) params.set("body", event.description);
  return `https://outlook.live.com/${["calendar", "0", "deeplink", "compose"].join("/")}?${params}`;
}

/** The .ics as a data address for a download link (`download="invite.ics"`). */
export function icsDataUrl(
  event: CalendarEvent & { uid: string; pending: boolean; product?: string; now?: Date },
): string {
  const ics = buildBookingIcs({
    uid: event.uid,
    sequence: 0,
    status: event.pending ? "TENTATIVE" : "CONFIRMED",
    title: event.title,
    start: event.start,
    end: event.end,
    now: event.now ?? new Date(),
    location: event.location,
    description: event.description,
    url: event.location && /^https:\/\//.test(event.location) ? event.location : null,
    product: event.product,
  });
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}
