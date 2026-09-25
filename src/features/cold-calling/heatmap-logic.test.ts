import { describe, expect, it } from "vitest";
import { buildHeatmap, HOURS } from "./heatmap-logic";

describe("buildHeatmap", () => {
  it("lays out Monday to Sunday, 7 to 20 h, scaling colour to the best cell", () => {
    const map = buildHeatmap([
      { day_of_week: 2, hour: 10, attempts: 100, meetings: 10 },
      { day_of_week: 2, hour: 11, attempts: 40, meetings: 2 },
      { day_of_week: 0, hour: 9, attempts: 19, meetings: 19 }, // too little data
      { day_of_week: 3, hour: 22, attempts: 50, meetings: 5 }, // outside the grid, still counted
    ]);
    expect(map.rows.map((row) => row.day)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(map.rows[0].cells).toHaveLength(HOURS.length);
    expect(map.totalAttempts).toBe(209);
    expect(map.enough).toBe(true);

    const tuesday = map.rows[1].cells;
    expect(tuesday.find((cell) => cell.hour === 10)).toMatchObject({ share: 0.1, level: 1 });
    expect(tuesday.find((cell) => cell.hour === 11)).toMatchObject({ share: 0.05, level: 0.5 });
    expect(map.rows[6].cells.find((cell) => cell.hour === 9)).toMatchObject({
      share: null,
      level: null,
    });
  });

  it("is not enough below 200 attempts in the country", () => {
    expect(buildHeatmap([{ day_of_week: 1, hour: 9, attempts: 199, meetings: 5 }]).enough).toBe(
      false,
    );
    expect(buildHeatmap([]).rows[0].cells[0]).toMatchObject({ attempts: 0, share: null });
  });
});
