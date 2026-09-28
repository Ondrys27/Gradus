import { describe, expect, it } from "vitest";
import {
  compareToPrevious,
  dueFollowUps,
  daySummaryParts,
  greetingPart,
  stalledCutoff,
  winRate,
  winRateSeries,
} from "./dashboard-logic";

const NOW = new Date("2026-09-28T10:00:00Z");
const day = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000).toISOString();
const won = (offset: number) => ({ won_at: day(offset), lost_at: null });
const lost = (offset: number) => ({ won_at: null, lost_at: day(offset) });

describe("greetingPart", () => {
  it("follows the wall clock of the user's zone, not UTC", () => {
    const instant = new Date("2026-09-28T22:30:00Z");
    expect(greetingPart(instant, "UTC")).toBe("evening");
    expect(greetingPart(instant, "Asia/Tokyo")).toBe("morning");
    expect(greetingPart(instant, "Europe/Prague")).toBe("night");
    expect(greetingPart(new Date("2026-09-28T07:00:00Z"), "Europe/Prague")).toBe("morning");
    expect(greetingPart(new Date("2026-09-28T12:00:00Z"), "Europe/Prague")).toBe("afternoon");
  });
});

describe("daySummaryParts", () => {
  it("names only what the day holds, in a fixed order", () => {
    expect(daySummaryParts({ tasks: 0, events: 2, followUps: 0, deals: 3 })).toEqual([
      { part: "events", count: 2 },
      { part: "deals", count: 3 },
    ]);
    expect(daySummaryParts({ tasks: 0, events: 0, followUps: 0, deals: 0 })).toEqual([]);
  });
});

describe("compareToPrevious", () => {
  it("reports the direction and the size of the change", () => {
    expect(compareToPrevious(1500, 1000)).toEqual({ direction: "up", difference: 500 });
    expect(compareToPrevious(200.5, 1000)).toEqual({ direction: "down", difference: 799.5 });
    expect(compareToPrevious(0, 0)).toEqual({ direction: "same", difference: 0 });
    expect(compareToPrevious(10.001, 10)).toEqual({ direction: "same", difference: 0 });
  });
});

describe("winRate", () => {
  it("is won out of closed, and null while nothing closed", () => {
    expect(winRate([])).toEqual({ won: 0, lost: 0, rate: null });
    expect(winRate([won(-1), won(-2), lost(-3), lost(-4)]).rate).toBe(0.5);
    expect(winRate([lost(-1)]).rate).toBe(0);
  });

  it("ignores deals that closed before the window", () => {
    const since = NOW.getTime() - 90 * 86_400_000;
    expect(winRate([won(-10), lost(-200)], since)).toEqual({ won: 1, lost: 0, rate: 1 });
  });
});

describe("winRateSeries", () => {
  it("is a running figure that stays empty until the first deal closes", () => {
    const series = winRateSeries([lost(-60), won(-30), won(-5)], NOW, 90, 3);
    // Windows end at day -60, -30 and now: closed so far are 1 (lost), 2 (1 won), 3 (2 won).
    expect(series).toHaveLength(3);
    expect(series[0]).toBe(0);
    expect(series[1]).toBe(0.5);
    expect(series[2]).toBeCloseTo(2 / 3);
  });

  it("gives null for the points before anything closed and leaves old deals out", () => {
    const series = winRateSeries([won(-10), won(-400)], NOW, 90, 3);
    expect(series).toEqual([null, null, 1]);
  });
});

describe("dueFollowUps", () => {
  const end = new Date("2026-09-28T22:00:00Z");
  const entries = [
    { id: "later", answers: { f: "2026-09-29T09:00:00Z" } },
    { id: "today", answers: { f: "2026-09-28T13:00:00Z" } },
    { id: "overdue", answers: { f: "2026-09-20T09:00:00Z" } },
    { id: "wrong-field", answers: { other: "2026-09-28T09:00:00Z" } },
    { id: "garbage", answers: { f: "soon" } },
    { id: "list", answers: [] },
  ];

  it("keeps today and overdue, earliest first, and skips what has no usable date", () => {
    expect(dueFollowUps(entries, "f", end).map((entry) => entry.id)).toEqual(["overdue", "today"]);
  });

  it("finds nothing when the table has no date question", () => {
    expect(dueFollowUps(entries, null, end)).toEqual([]);
  });
});

describe("stalledCutoff", () => {
  it("is the moment two weeks ago", () => {
    expect(stalledCutoff(NOW)).toBe("2026-09-14T10:00:00.000Z");
  });
});
