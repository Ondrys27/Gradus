import { addDays, instantAtMinute, isValidTimeZone } from "@/features/scheduler/zoned";
import { METRICS_TIMEZONE } from "@/lib/analytics/metrics";

/**
 * When each administrator gets the daily summary (30.1). Vercel Hobby runs
 * the job once a day (vercel.json, early morning UTC); it prepares every
 * e-mail then and Resend sends it at the administrator's own hour
 * (scheduled_at). An hour already gone today goes out at once.
 */

export const DEFAULT_DIGEST_HOUR = 6;
/** Resend holds a scheduled e-mail at most this long ahead. */
export const RESEND_SCHEDULE_MAX_MS = 72 * 3_600_000;
/** Closer than this, the e-mail simply goes now. */
const NOW_WINDOW_MS = 2 * 60_000;

export type DigestPrefs = {
  enabled: boolean;
  hour: number;
  onlyNews: boolean;
  /** The administrator's choice; null = the account's zone, else the metrics' zone. */
  timeZone: string | null;
};

export const DEFAULT_DIGEST_PREFS: DigestPrefs = {
  enabled: true,
  hour: DEFAULT_DIGEST_HOUR,
  onlyNews: false,
  timeZone: null,
};

/** A stored row of admin_notify_prefs (or none) as the prefs. */
export function digestPrefsOf(
  row: {
    digest_enabled?: boolean | null;
    digest_hour?: number | null;
    digest_only_news?: boolean | null;
    digest_time_zone?: string | null;
  } | null | undefined,
): DigestPrefs {
  if (!row) return DEFAULT_DIGEST_PREFS;
  const hour = Number(row.digest_hour);
  return {
    enabled: row.digest_enabled ?? true,
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_DIGEST_HOUR,
    onlyNews: row.digest_only_news ?? false,
    timeZone: row.digest_time_zone && isValidTimeZone(row.digest_time_zone) ? row.digest_time_zone : null,
  };
}

/** The zone the summary is timed in: the chosen one, the account's, the metrics'. */
export function digestZone(prefs: DigestPrefs, accountZone: string | null | undefined): string {
  if (prefs.timeZone) return prefs.timeZone;
  return accountZone && isValidTimeZone(accountZone) ? accountZone : METRICS_TIMEZONE;
}

/**
 * The moment to send the summary of `reportedDay`: the morning after it at
 * `hour` in the zone, or null for "now" when that moment has passed already
 * (zones east of the job's run) or is about to come. Never more than Resend
 * can hold.
 */
export function digestSendAt(
  hour: number,
  timeZone: string,
  reportedDay: string,
  nowMs: number,
): string | null {
  const at = instantAtMinute(addDays(reportedDay, 1), hour * 60, timeZone);
  if (at - nowMs <= NOW_WINDOW_MS) return null;
  if (at - nowMs > RESEND_SCHEDULE_MAX_MS) return null;
  return new Date(at).toISOString();
}
