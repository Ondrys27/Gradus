import { APP_NAME } from "@/lib/constants";
import { addDays, dayIn, isValidTimeZone } from "../zoned";

/**
 * The account's calendar as an iCalendar feed that Google, Apple and
 * Outlook subscribe to ("Odkaz pro odběr kalendáře"). Pure: the route reads
 * the events and passes them in.
 */

export type FeedEvent = {
  uid: string;
  title: string;
  /** ISO instant. All-day: the midnight of the first day in `timeZone`. */
  start: string;
  /**
   * ISO instant; null = one hour for a timed event, one day for an all-day
   * one. All-day: the midnight of the LAST day the event covers (as Gradus
   * stores calendar_events.ends_at), so the feed's DTEND is the day after.
   */
  end: string | null;
  allDay: boolean;
  description?: string | null;
  location?: string | null;
  updatedAt?: string;
};

const CRLF = "\r\n";
/** A timed event without an end is shown as one hour, like the calendar does. */
const DEFAULT_LENGTH_MS = 60 * 60_000;
/** RFC 5545: lines of at most 75 octets, continued after a space. */
const LINE_OCTETS = 75;

const pad = (value: number) => String(value).padStart(2, "0");

/** `YYYYMMDDTHHMMSSZ`. */
export function icsUtc(instant: Date): string {
  return (
    `${instant.getUTCFullYear()}${pad(instant.getUTCMonth() + 1)}${pad(instant.getUTCDate())}` +
    `T${pad(instant.getUTCHours())}${pad(instant.getUTCMinutes())}${pad(instant.getUTCSeconds())}Z`
  );
}

const icsDate = (day: string) => day.replace(/-/g, "");

/** TEXT values: backslash, semicolon, comma and line breaks escaped. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Folds a line at 75 octets without splitting a multi-byte character. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= LINE_OCTETS) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    // Continuation lines start with a space, which counts too.
    const limit = parts.length === 0 ? LINE_OCTETS : LINE_OCTETS - 1;
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

/** UIDs and other identifiers: no line breaks, no control characters. */
const safeId = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200);

export function buildIcsFeed(args: {
  name: string;
  events: readonly FeedEvent[];
  now: Date;
  /** Where all-day events have their days; UTC by default. */
  timeZone?: string;
}): string {
  const zone = args.timeZone && isValidTimeZone(args.timeZone) ? args.timeZone : "UTC";
  const stamp = icsUtc(args.now);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${APP_NAME}//Calendar//EN`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(args.name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const event of args.events) {
    const start = Date.parse(event.start);
    if (!Number.isFinite(start)) continue;
    const endParsed = event.end ? Date.parse(event.end) : Number.NaN;
    lines.push("BEGIN:VEVENT", `UID:${safeId(event.uid)}`, `DTSTAMP:${stamp}`);
    if (event.updatedAt && Number.isFinite(Date.parse(event.updatedAt))) {
      lines.push(`LAST-MODIFIED:${icsUtc(new Date(event.updatedAt))}`);
    }
    if (event.allDay) {
      const first = dayIn(start, zone);
      const last = Number.isFinite(endParsed) ? dayIn(endParsed, zone) : first;
      const after = addDays(last < first ? first : last, 1);
      lines.push(`DTSTART;VALUE=DATE:${icsDate(first)}`, `DTEND;VALUE=DATE:${icsDate(after)}`);
      lines.push("TRANSP:TRANSPARENT");
    } else {
      const end =
        Number.isFinite(endParsed) && endParsed > start ? endParsed : start + DEFAULT_LENGTH_MS;
      lines.push(`DTSTART:${icsUtc(new Date(start))}`, `DTEND:${icsUtc(new Date(end))}`);
    }
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join(CRLF) + CRLF;
}
