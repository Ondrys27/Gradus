/**
 * Reminders of a confirmed booking (24.4): one e-mail to the guest and one to
 * the host for every reminder of the meeting type (minutes before the start),
 * scheduled with Resend (`scheduled_at`), which takes them at most 30 days
 * ahead. What lies further is left for the daily cron, which schedules it as
 * soon as it comes into the window. The ids Resend gave are kept on the
 * booking (`reminder_ids`) so a move or a cancellation cancels them.
 */

export const REMINDER_TARGETS = ["guest", "host"] as const;
export type ReminderTarget = (typeof REMINDER_TARGETS)[number];

/** Resend schedules up to 30 days ahead; an hour of margin for the clocks. */
export const SCHEDULE_WINDOW_MS = 30 * 86_400_000 - 3_600_000;
/** A reminder due sooner than this is not worth sending any more. */
export const MIN_LEAD_MS = 2 * 60_000;

/** One scheduled e-mail: which reminder, the id Resend gave (null in tests), when. */
export type ScheduledReminder = { key: string; id: string | null; at: string };

export type PlannedReminder = {
  key: string;
  target: ReminderTarget;
  offsetMinutes: number;
  at: string;
};

export function reminderKey(target: ReminderTarget, offsetMinutes: number): string {
  return `${target}:${offsetMinutes}`;
}

/** The stored list, whatever the column holds; anything malformed is dropped. */
export function parseReminderIds(value: unknown): ScheduledReminder[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { key, id, at } = item as Record<string, unknown>;
    if (typeof key !== "string" || !/^(guest|host):\d{1,5}$/.test(key)) return [];
    if (typeof at !== "string" || !Number.isFinite(Date.parse(at))) return [];
    return [{ key, id: typeof id === "string" && id ? id : null, at }];
  });
}

/**
 * The reminders to schedule now: not already scheduled, not in the past (or
 * about to be), and inside Resend's window. Earliest first.
 */
export function planReminders(input: {
  startsAt: string;
  offsets: readonly number[];
  now: number;
  scheduled: readonly ScheduledReminder[];
}): PlannedReminder[] {
  const start = Date.parse(input.startsAt);
  if (!Number.isFinite(start)) return [];
  const done = new Set(input.scheduled.map((item) => item.key));
  const offsets = [...new Set(input.offsets.filter((n) => Number.isInteger(n) && n > 0))];
  const out: PlannedReminder[] = [];
  for (const target of REMINDER_TARGETS) {
    for (const offsetMinutes of offsets) {
      const key = reminderKey(target, offsetMinutes);
      if (done.has(key)) continue;
      const at = start - offsetMinutes * 60_000;
      if (at < input.now + MIN_LEAD_MS) continue;
      if (at > input.now + SCHEDULE_WINDOW_MS) continue;
      out.push({ key, target, offsetMinutes, at: new Date(at).toISOString() });
    }
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.key.localeCompare(b.key));
}

/** Whether any reminder of the meeting still waits for the window (the cron's question). */
export function remindersLater(input: {
  startsAt: string;
  offsets: readonly number[];
  now: number;
  scheduled: readonly ScheduledReminder[];
}): boolean {
  const start = Date.parse(input.startsAt);
  const done = new Set(input.scheduled.map((item) => item.key));
  return REMINDER_TARGETS.some((target) =>
    input.offsets.some(
      (offset) =>
        !done.has(reminderKey(target, offset)) &&
        start - offset * 60_000 > input.now + SCHEDULE_WINDOW_MS,
    ),
  );
}
