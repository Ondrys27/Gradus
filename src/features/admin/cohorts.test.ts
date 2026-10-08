import { describe, expect, it } from "vitest";
import { averageCurve, cohortRows, dropOff, funnelSteps, heatmapGrid } from "./cohorts";

describe("cohorts", () => {
  const rows = [
    { cohort_week: "2026-09-21", cohort_size: 10, week: 0, active_users: 10, pct: 100 },
    { cohort_week: "2026-09-21", cohort_size: 10, week: 1, active_users: 5, pct: 50 },
    { cohort_week: "2026-09-28", cohort_size: 30, week: 0, active_users: 30, pct: 100 },
    { cohort_week: "2026-09-28", cohort_size: 30, week: 1, active_users: 3, pct: 10 },
    { cohort_week: "2026-09-14", cohort_size: 0, week: 99, active_users: 0, pct: 0 },
  ];

  it("groups rows into one line per sign-up week, oldest first", () => {
    const cohorts = cohortRows(rows, 2);
    expect(cohorts.map((cohort) => cohort.week)).toEqual(["2026-09-21", "2026-09-28"]);
    expect(cohorts[0]).toEqual({ week: "2026-09-21", size: 10, cells: [100, 50, null] });
  });

  it("weights the average curve by cohort size and skips weeks not reached", () => {
    expect(averageCurve(cohortRows(rows, 2))).toEqual([100, 20, null]);
    expect(averageCurve([])).toEqual([]);
  });
});

describe("funnel", () => {
  it("orders steps and keeps the previous share for comparison", () => {
    const steps = funnelSteps(
      [
        {
          step: 2,
          step_key: "onboarding_completed",
          users: 6,
          pct_of_start: 60,
          pct_of_previous: 60,
          median_hours_from_previous: 0.5,
          median_hours_from_start: 0.5,
        },
        {
          step: 1,
          step_key: "registered",
          users: 10,
          pct_of_start: 100,
          pct_of_previous: 100,
          median_hours_from_previous: null,
          median_hours_from_start: null,
        },
      ],
      [{ step: 2, step_key: "onboarding_completed", pct_of_start: 40 }],
    );
    expect(steps.map((step) => step.key)).toEqual(["registered", "onboarding_completed"]);
    expect(steps[1].previousPctOfStart).toBe(40);
    expect(steps[0].previousPctOfStart).toBeNull();
    expect(dropOff(steps[1])).toBe(40);
    expect(dropOff(steps[0])).toBe(0);
  });
});

describe("usage heat map", () => {
  it("fills a full week of hours and ignores bad rows", () => {
    const grid = heatmapGrid([
      { weekday: 1, hour: 9, events: 12, users: 3 },
      { weekday: 8, hour: 9, events: 1, users: 1 },
    ]);
    expect(grid).toHaveLength(7);
    expect(grid[0]).toHaveLength(24);
    expect(grid[0][9]).toEqual({ weekday: 1, hour: 9, events: 12, users: 3 });
    expect(grid.flat().reduce((sum, cell) => sum + cell.events, 0)).toBe(12);
  });
});
