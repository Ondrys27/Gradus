import { describe, expect, it } from "vitest";
import {
  currentWeek,
  isWeekPast,
  monthSpan,
  monthWeeks,
  planWeekOf,
  shiftMonth,
  weekCount,
  weekInMonth,
} from "./weeks";

describe("weeks of a plan month", () => {
  it("November 2026 has five weeks, the last one reaching into December", () => {
    expect(monthWeeks("2026-11")).toEqual([
      { week: 1, start: "2026-11-02", end: "2026-11-08" },
      { week: 2, start: "2026-11-09", end: "2026-11-15" },
      { week: 3, start: "2026-11-16", end: "2026-11-22" },
      { week: 4, start: "2026-11-23", end: "2026-11-29" },
      { week: 5, start: "2026-11-30", end: "2026-12-06" },
    ]);
  });

  it("a day before the first Monday belongs to the previous month", () => {
    // 1 November 2026 is a Sunday: week 4 of October (26 Oct – 1 Nov).
    expect(planWeekOf("2026-11-01")).toEqual({ month: "2026-10", week: 4 });
    expect(weekInMonth("2026-11", "2026-11-01")).toBeNull();
    // 3 December is in November's week 5.
    expect(planWeekOf("2026-12-03")).toEqual({ month: "2026-11", week: 5 });
  });

  it("across the turn of the year: December 2026 has 4, its last week ends in January", () => {
    expect(weekCount("2026-12")).toBe(4);
    expect(monthSpan("2026-12")).toEqual({ from: "2026-12-07", to: "2027-01-03" });
    expect(planWeekOf("2027-01-02")).toEqual({ month: "2026-12", week: 4 });
    expect(monthWeeks("2027-01")[0]).toEqual({ week: 1, start: "2027-01-04", end: "2027-01-10" });
    // 2024 → 2025: 30 December 2024 is a Monday, so 30 Dec – 5 Jan is December's.
    expect(planWeekOf("2025-01-01")).toEqual({ month: "2024-12", week: 5 });
  });

  it("a month starting on Monday starts its week 1 that day", () => {
    expect(monthWeeks("2026-06")[0].start).toBe("2026-06-01");
    expect(weekCount("2026-06")).toBe(5);
    expect(weekCount("2026-02")).toBe(4);
    // February 2027 starts on a Monday and has exactly four weeks.
    expect(monthWeeks("2027-02")).toHaveLength(4);
  });

  it("shifts months across years", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
    expect(shiftMonth("2026-11", -13)).toBe("2025-10");
  });

  it("knows the current and past weeks", () => {
    const [first] = monthWeeks("2026-11");
    expect(isWeekPast(first, "2026-11-08")).toBe(false);
    expect(isWeekPast(first, "2026-11-09")).toBe(true);
    expect(currentWeek("2026-11", "2026-11-10")).toBe(2);
    expect(currentWeek("2026-11", "2026-12-07")).toBeNull();
  });
});
