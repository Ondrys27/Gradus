import { describe, expect, it } from "vitest";
import { axisTicks } from "./daily-bar-chart";

const bars = (count: number, current: number) =>
  Array.from({ length: count }, (_, index) => ({
    key: `2026-10-${String(index + 1).padStart(2, "0")}`,
    current: index === current,
  }));

describe("axisTicks", () => {
  it("labels every day of a week, today included", () => {
    expect(axisTicks(bars(7, 5), "week")).toHaveLength(7);
  });

  it("always labels today in a month and keeps its neighbours apart", () => {
    const ticks = axisTicks(bars(31, 16), "month");
    expect(ticks).toContain("2026-10-17");
    expect(ticks).not.toContain("2026-10-16");
    expect(ticks).toContain("2026-10-01");
    expect(ticks).toContain("2026-10-26");
  });

  it("labels this month in a year and thins the others", () => {
    const ticks = axisTicks(bars(12, 9), "year");
    expect(ticks).toContain("2026-10-10");
    expect(ticks).not.toContain("2026-10-09");
    expect(ticks).not.toContain("2026-10-11");
    expect(ticks.length).toBeLessThanOrEqual(7);
  });
});
