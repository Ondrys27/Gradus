import { describe, expect, it } from "vitest";
import {
  MIN_LEAD_MS,
  parseReminderIds,
  planReminders,
  reminderKey,
  remindersLater,
  SCHEDULE_WINDOW_MS,
} from "./reminders";

const NOW = Date.parse("2026-11-01T08:00:00Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("planning the reminders of a booking", () => {
  it("one for the guest and one for the host per reminder, earliest first", () => {
    const start = iso(NOW + 3 * DAY);
    const plan = planReminders({ startsAt: start, offsets: [1440, 60], now: NOW, scheduled: [] });
    expect(plan.map((item) => item.key)).toEqual(["guest:1440", "host:1440", "guest:60", "host:60"]);
    expect(plan[0]!.at).toBe(iso(NOW + 2 * DAY));
    expect(plan[2]!.at).toBe(iso(NOW + 3 * DAY - 3_600_000));
  });

  it("skips the ones already scheduled, in the past or about to be", () => {
    const start = iso(NOW + 2 * 3_600_000);
    const plan = planReminders({
      startsAt: start,
      offsets: [1440, 60, 119],
      now: NOW,
      scheduled: [{ key: reminderKey("guest", 60), id: "re_1", at: iso(NOW + 3_600_000) }],
    });
    // 24 h before is gone, 119 min before is a minute from now (too close), the guest's hour is done.
    expect(plan.map((item) => item.key)).toEqual(["host:60"]);
    expect(MIN_LEAD_MS).toBeGreaterThan(60_000);
  });

  it("leaves what lies beyond Resend's 30 days for the daily cron", () => {
    const start = iso(NOW + 45 * DAY);
    expect(planReminders({ startsAt: start, offsets: [1440], now: NOW, scheduled: [] })).toEqual([]);
    expect(remindersLater({ startsAt: start, offsets: [1440], now: NOW, scheduled: [] })).toBe(true);
    // Fifteen days later the cron finds it inside the window.
    const later = NOW + 15 * DAY;
    const plan = planReminders({ startsAt: start, offsets: [1440], now: later, scheduled: [] });
    expect(plan.map((item) => item.key)).toEqual(["guest:1440", "host:1440"]);
    expect(Date.parse(plan[0]!.at) - later).toBeLessThanOrEqual(SCHEDULE_WINDOW_MS);
    expect(remindersLater({ startsAt: start, offsets: [1440], now: later, scheduled: [] })).toBe(false);
  });

  it("ignores broken offsets and duplicates", () => {
    const start = iso(NOW + 3 * DAY);
    const plan = planReminders({ startsAt: start, offsets: [60, 60, -5, 0, 1.5], now: NOW, scheduled: [] });
    expect(plan.map((item) => item.key)).toEqual(["guest:60", "host:60"]);
    expect(planReminders({ startsAt: "nonsense", offsets: [60], now: NOW, scheduled: [] })).toEqual([]);
  });
});

describe("the stored reminder ids", () => {
  it("keeps well-formed entries only", () => {
    expect(
      parseReminderIds([
        { key: "guest:60", id: "re_1", at: "2026-11-02T08:00:00Z" },
        { key: "host:1440", id: null, at: "2026-11-02T08:00:00Z" },
        { key: "other:60", id: "x", at: "2026-11-02T08:00:00Z" },
        { key: "guest:60", id: "x", at: "nope" },
        "junk",
        null,
      ]),
    ).toEqual([
      { key: "guest:60", id: "re_1", at: "2026-11-02T08:00:00Z" },
      { key: "host:1440", id: null, at: "2026-11-02T08:00:00Z" },
    ]);
    expect(parseReminderIds({})).toEqual([]);
  });
});
