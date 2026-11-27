import { describe, expect, it } from "vitest";
import { dayCells, dayState, freeSlotAt, stateAt, weekGrid, weekOfDay, weeksOf } from "./slot-grid";
import type { GuestDay } from "./slots";
import { instantAtMinute } from "./zoned";

const PRAGUE = "Europe/Prague";
const slot = (day: string, time: string, minutes = 30) => {
  const [h, m] = time.split(":").map(Number);
  const start = instantAtMinute(day, h * 60 + m, PRAGUE);
  return { start, end: start + minutes * 60_000, time };
};

// Monday 16 and Tuesday 17 November 2026.
const days: GuestDay[] = [
  { day: "2026-11-16", slots: [slot("2026-11-16", "09:00")], busy: [slot("2026-11-16", "09:30")] },
  { day: "2026-11-17", slots: [], busy: [slot("2026-11-17", "10:00")] },
  { day: "2026-11-25", slots: [slot("2026-11-25", "14:00")], busy: [] },
];

describe("the shared picker's week", () => {
  it("weeks are seven days in a row from the first day with a time; only weeks with times count", () => {
    expect(weeksOf(days)).toEqual(["2026-11-16", "2026-11-23"]);
    expect(weekOfDay(weeksOf(days), "2026-11-25")).toBe("2026-11-23");
    expect(weekOfDay(weeksOf(days), "2026-11-17")).toBe("2026-11-16");
    expect(weeksOf([])).toEqual([]);
    // A Saturday first: the week runs to Friday.
    expect(weeksOf([{ day: "2026-11-21", slots: [slot("2026-11-21", "09:00")] }])).toEqual([
      "2026-11-21",
    ]);
  });

  it("a day is free, full or off", () => {
    expect(dayState(days[0])).toBe("free");
    expect(dayState(days[1])).toBe("busy");
    expect(dayState(undefined)).toBe("off");
    expect(dayCells(days[0]).map((cell) => [cell.time, cell.state])).toEqual([
      ["09:00", "free"],
      ["09:30", "busy"],
    ]);
  });

  it("rows are every time of the week; a day without that time is quiet, with its start", () => {
    const grid = weekGrid(days, "2026-11-16", PRAGUE);
    expect(grid.days).toHaveLength(7);
    expect(grid.rows.map((row) => row.time)).toEqual(["09:00", "09:30", "10:00"]);
    const tuesdayNine = grid.rows[0].cells[1];
    expect(tuesdayNine).toMatchObject({ day: "2026-11-17", state: "off", end: null });
    expect(tuesdayNine.start).toBe(instantAtMinute("2026-11-17", 9 * 60, PRAGUE));
    expect(grid.rows[2].cells[1].state).toBe("busy");
  });

  it("a typed time is free, taken or outside the offer", () => {
    expect(stateAt(days, days[0].slots[0].start)).toBe("free");
    expect(stateAt(days, days[0].busy![0].start)).toBe("busy");
    expect(stateAt(days, instantAtMinute("2026-11-16", 7 * 60, PRAGUE))).toBe("off");
    expect(freeSlotAt(days, days[2].slots[0].start)?.time).toBe("14:00");
    expect(freeSlotAt(days, days[0].busy![0].start)).toBeNull();
  });
});
