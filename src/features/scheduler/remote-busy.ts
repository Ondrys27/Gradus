import type { RemoteEvent } from "@/features/calendar/sync/types";
import { mergeIntervals, type Interval } from "./slots";

/**
 * Busy times of a connected calendar read live for the scheduler (30.4),
 * pure so the server and Vitest share it. A calendar the person does not
 * show in Gradus is still read here, when the scheduler counts it.
 */

const DAY = 86_400_000;
const MINUTE = 60_000;
/** How far the live read reaches: the 60-day horizon of a type and a day either side. */
export const LIVE_WINDOW_BEFORE_MS = DAY;
export const LIVE_WINDOW_AFTER_MS = 63 * DAY;
/** The booking page answers from what is at most this old. */
export const LIVE_PAGE_MAX_AGE_MS = 5 * MINUTE;
/** Holding and booking a time read again what is older than this. */
export const LIVE_CONFIRM_MAX_AGE_MS = 60_000;
/** A failed read falls back to what was read within this long. */
export const LIVE_STALE_FALLBACK_MS = DAY;

/**
 * The busy intervals of the provider's events: not cancelled, not "free",
 * never the events Gradus itself wrote there (`own`, the external ids linked
 * to Gradus events: they already count as Gradus's, or as bookings).
 * All-day events block from the first day's midnight to the end of the last.
 */
export function busyOfRemote(events: readonly RemoteEvent[], own: ReadonlySet<string>): Interval[] {
  const out: Interval[] = [];
  for (const event of events) {
    if (event.cancelled || event.transparent || own.has(event.externalId)) continue;
    const start = Date.parse(event.startsAt);
    if (!Number.isFinite(start)) continue;
    if (event.allDay) {
      const last = event.endsAt ? Date.parse(event.endsAt) : start;
      out.push({ start, end: Math.max(Number.isFinite(last) ? last : start, start) + DAY });
      continue;
    }
    const end = event.endsAt ? Date.parse(event.endsAt) : start + 60 * MINUTE;
    out.push({ start, end: Math.max(Number.isFinite(end) ? end : start, start + MINUTE) });
  }
  return mergeIntervals(out);
}

export type CacheRow = { fetched_at: string; window_from: string; window_to: string };

/** Whether a cached read covers the window and is young enough. */
export function cacheUsable(
  row: CacheRow | null | undefined,
  window: { from: number; to: number },
  now: number,
  maxAgeMs: number,
): boolean {
  if (!row) return false;
  const fetched = Date.parse(row.fetched_at);
  if (!Number.isFinite(fetched) || now - fetched > maxAgeMs || fetched > now + MINUTE) return false;
  return Date.parse(row.window_from) <= window.from && Date.parse(row.window_to) >= window.to;
}

/** Intervals as JSON for the cache, and back (anything broken dropped). */
export function intervalsToJson(list: readonly Interval[]) {
  return list.map((item) => ({
    start: new Date(item.start).toISOString(),
    end: new Date(item.end).toISOString(),
  }));
}

export function intervalsFromJson(value: unknown): Interval[] {
  if (!Array.isArray(value)) return [];
  const out: Interval[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const start = Date.parse(String((raw as Record<string, unknown>).start));
    const end = Date.parse(String((raw as Record<string, unknown>).end));
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) out.push({ start, end });
  }
  return out;
}
