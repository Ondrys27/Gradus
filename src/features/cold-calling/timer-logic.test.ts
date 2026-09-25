import { describe, expect, it } from "vitest";
import { formatStopwatch } from "@/lib/format";
import { pastDeadline, shownSeconds, type TimerReading } from "./timer-logic";

const base: TimerReading = {
  running: true,
  todaySeconds: 600,
  idleDeadline: "2026-09-25T10:15:00Z",
  serverNow: "2026-09-25T10:05:00Z",
  idleClosedAt: null,
  // The device clock is 3 minutes ahead of the server.
  receivedAt: Date.parse("2026-09-25T10:08:00Z"),
};

describe("timer between reads", () => {
  it("counts on locally from the reading", () => {
    expect(shownSeconds(base, base.receivedAt + 65_000)).toBe(665);
  });

  it("stops at the idle deadline measured on the device's clock", () => {
    // Deadline is 10 minutes after the reading, whatever the clock offset.
    expect(shownSeconds(base, base.receivedAt + 30 * 60_000)).toBe(600 + 10 * 60);
    expect(pastDeadline(base, base.receivedAt + 10 * 60_000 - 1)).toBe(false);
    expect(pastDeadline(base, base.receivedAt + 10 * 60_000)).toBe(true);
  });

  it("stands still when paused", () => {
    const paused = { ...base, running: false, idleDeadline: null };
    expect(shownSeconds(paused, base.receivedAt + 999_000)).toBe(600);
    expect(pastDeadline(paused, base.receivedAt + 999_000)).toBe(false);
  });
});

describe("formatStopwatch", () => {
  it("pads hours, minutes and seconds", () => {
    expect(formatStopwatch(0)).toBe("00:00:00");
    expect(formatStopwatch(3725)).toBe("01:02:05");
    expect(formatStopwatch(-4)).toBe("00:00:00");
  });
});
