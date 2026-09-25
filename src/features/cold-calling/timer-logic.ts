/**
 * What the timer shows between reads. The database is the only record: the
 * browser takes one reading and counts on locally, never writing while it runs.
 */

export type TimerReading = {
  running: boolean;
  /** Seconds today up to the moment of the reading, day-clipped in the user's zone. */
  todaySeconds: number;
  /** When the open segment ends by itself without another move out of Unreached. */
  idleDeadline: string | null;
  serverNow: string;
  /** Set only on the read that closed an idle segment. */
  idleClosedAt: string | null;
  /** Local clock when the reading arrived; server and device clocks may differ. */
  receivedAt: number;
};

/** The idle deadline on the device's clock. */
export function localDeadline(reading: TimerReading): number | null {
  if (!reading.running || !reading.idleDeadline) return null;
  return reading.receivedAt + (Date.parse(reading.idleDeadline) - Date.parse(reading.serverNow));
}

/** Seconds to show now: the reading plus the time since, never past the idle deadline. */
export function shownSeconds(reading: TimerReading, now: number): number {
  if (!reading.running) return reading.todaySeconds;
  const deadline = localDeadline(reading) ?? now;
  const since = Math.max(0, Math.min(now, deadline) - reading.receivedAt);
  return Math.floor(reading.todaySeconds + since / 1000);
}

/** The deadline has passed locally; a fresh read closes the segment as idle. */
export function pastDeadline(reading: TimerReading, now: number): boolean {
  const deadline = localDeadline(reading);
  return deadline !== null && now >= deadline;
}
