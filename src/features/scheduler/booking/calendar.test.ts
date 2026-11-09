import { describe, expect, it } from "vitest";
import { addMonths, bookableMonths, monthGrid, monthOf } from "./calendar";

describe("the month calendar of the booking page", () => {
  it("lays out November 2026 from Monday", () => {
    const cells = monthGrid("2026-11", 1);
    // 1 November 2026 is a Sunday: six empty cells before it.
    expect(cells.slice(0, 7)).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(cells.filter(Boolean)).toHaveLength(30);
    expect(cells.length % 7).toBe(0);
  });

  it("from Sunday it starts right away", () => {
    expect(monthGrid("2026-11", 0)[0]).toBe("2026-11-01");
  });

  it("knows the months with a free time, across a year's end", () => {
    expect(bookableMonths(["2027-01-04", "2026-12-30", "2026-12-01"])).toEqual(["2026-12", "2027-01"]);
    expect(bookableMonths([])).toEqual([]);
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthOf("2026-11-12")).toBe("2026-11");
  });
});
