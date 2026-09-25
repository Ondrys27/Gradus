import { describe, expect, it } from "vitest";
import { daysOf, periodRange, summarize, toBars } from "./stats-logic";

describe("periodRange", () => {
  it("follows the user's first day of the week", () => {
    // Friday 25 September 2026
    expect(periodRange({ kind: "week", offset: 0 }, "2026-09-25", 1)).toEqual({
      from: "2026-09-21",
      to: "2026-09-27",
    });
    expect(periodRange({ kind: "week", offset: 0 }, "2026-09-25", 0)).toEqual({
      from: "2026-09-20",
      to: "2026-09-26",
    });
    expect(periodRange({ kind: "week", offset: -1 }, "2026-09-25", 1).from).toBe("2026-09-14");
  });

  it("covers whole months and years", () => {
    expect(periodRange({ kind: "month", offset: -8 }, "2026-09-25", 1)).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(periodRange({ kind: "year", offset: 0 }, "2026-09-25", 1)).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
    });
    expect(daysOf({ from: "2028-02-27", to: "2028-03-01" })).toEqual([
      "2028-02-27",
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
  });
});

describe("bars and summary", () => {
  const byDay = new Map([
    ["2026-09-21", 600],
    ["2026-09-23", 1800],
    ["2026-09-25", 300],
    ["2026-09-26", 9999], // cannot happen, but a future day never counts
  ]);
  const range = { from: "2026-09-21", to: "2026-09-27" };

  it("marks today and future days", () => {
    const bars = toBars("week", range, byDay, "2026-09-25");
    expect(bars).toHaveLength(7);
    expect(bars.find((bar) => bar.current)?.key).toBe("2026-09-25");
    expect(bars.filter((bar) => bar.future).map((bar) => bar.key)).toEqual([
      "2026-09-26",
      "2026-09-27",
    ]);
  });

  it("adds a year up by month", () => {
    const bars = toBars("year", { from: "2026-01-01", to: "2026-12-31" }, byDay, "2026-09-25");
    expect(bars).toHaveLength(12);
    expect(bars[8]).toEqual({ key: "2026-09-01", value: 12699, current: true, future: false });
  });

  it("averages over the days that have begun and finds the best one", () => {
    expect(summarize(range, byDay, "2026-09-25")).toEqual({
      total: 2700,
      average: 540,
      best: { day: "2026-09-23", value: 1800 },
    });
    expect(summarize(range, new Map(), "2026-09-25").best).toBeNull();
  });
});
