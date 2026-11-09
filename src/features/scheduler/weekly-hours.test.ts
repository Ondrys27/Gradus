import { describe, expect, it } from "vitest";
import {
  nextInterval,
  orderedWeekdays,
  rulesToWeek,
  sameWeek,
  weekIssues,
  weekToRules,
} from "./weekly-hours";

describe("weekly hours", () => {
  it("round-trips the rules; midnight is 24:00 in the database and 00:00 on screen", () => {
    const rules = [
      { weekday: 1, start_time: "09:00:00", end_time: "12:00:00" },
      { weekday: 1, start_time: "13:00:00", end_time: "17:00:00" },
      { weekday: 5, start_time: "20:00:00", end_time: "24:00:00" },
    ];
    const week = rulesToWeek(rules);
    expect(week[1]).toEqual([
      { start: "09:00", end: "12:00" },
      { start: "13:00", end: "17:00" },
    ]);
    expect(week[5]).toEqual([{ start: "20:00", end: "00:00" }]);
    expect(weekToRules(week)).toEqual([
      { weekday: 1, start_time: "09:00", end_time: "12:00" },
      { weekday: 1, start_time: "13:00", end_time: "17:00" },
      { weekday: 5, start_time: "20:00", end_time: "24:00" },
    ]);
    expect(sameWeek(week, rulesToWeek(rules))).toBe(true);
  });

  it("finds intervals out of order or overlapping", () => {
    const week = rulesToWeek([]);
    week[2] = [
      { start: "10:00", end: "09:00" },
      { start: "09:00", end: "12:00" },
      { start: "11:00", end: "13:00" },
    ];
    expect(weekIssues(week)).toEqual([
      { weekday: 2, index: 0, code: "order" },
      { weekday: 2, index: 2, code: "overlap" },
    ]);
  });

  it("suggests the next interval and orders the week", () => {
    expect(nextInterval([])).toEqual({ start: "09:00", end: "17:00" });
    expect(nextInterval([{ start: "09:00", end: "12:00" }])).toEqual({
      start: "13:00",
      end: "14:00",
    });
    expect(orderedWeekdays(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(orderedWeekdays(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
