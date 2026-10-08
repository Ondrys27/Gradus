import type { CohortRow, FunnelStep, HeatmapCell } from "./types";

/**
 * Shapes the rows of the cohort, funnel and heat-map functions for the
 * pages. Pure, so it is tested without a database.
 */

type Row = Record<string, unknown>;

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** metric_cohorts() rows (week of sign-up × week after) as one row per cohort. */
export function cohortRows(rows: readonly Row[], weeks: number): CohortRow[] {
  const byWeek = new Map<string, CohortRow>();
  for (const row of rows) {
    const week = String(row.cohort_week).slice(0, 10);
    const index = num(row.week);
    if (index === null || index < 0 || index > weeks) continue;
    let cohort = byWeek.get(week);
    if (!cohort) {
      cohort = { week, size: num(row.cohort_size) ?? 0, cells: Array(weeks + 1).fill(null) };
      byWeek.set(week, cohort);
    }
    cohort.cells[index] = num(row.pct);
  }
  return [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week));
}

/**
 * The average retention curve: for each week after sign-up, the share active
 * across every cohort that has reached that week, weighted by cohort size.
 */
export function averageCurve(cohorts: readonly CohortRow[]): (number | null)[] {
  const length = Math.max(0, ...cohorts.map((cohort) => cohort.cells.length));
  return Array.from({ length }, (_, index) => {
    let people = 0;
    let active = 0;
    for (const cohort of cohorts) {
      const pct = cohort.cells[index];
      if (pct === null || pct === undefined || cohort.size <= 0) continue;
      people += cohort.size;
      active += (pct / 100) * cohort.size;
    }
    return people > 0 ? Math.round((1000 * active) / people) / 10 : null;
  });
}

/** metric_funnel() rows in step order, with the previous period's share when given. */
export function funnelSteps(rows: readonly Row[], previous?: readonly Row[]): FunnelStep[] {
  const before = new Map(
    (previous ?? []).map((row) => [String(row.step_key), num(row.pct_of_start)]),
  );
  return [...rows]
    .sort((a, b) => (num(a.step) ?? 0) - (num(b.step) ?? 0))
    .map((row) => ({
      key: String(row.step_key),
      users: num(row.users) ?? 0,
      pctOfStart: num(row.pct_of_start) ?? 0,
      pctOfPrevious: num(row.pct_of_previous) ?? 0,
      medianHoursFromPrevious: num(row.median_hours_from_previous),
      medianHoursFromStart: num(row.median_hours_from_start),
      ...(previous ? { previousPctOfStart: before.get(String(row.step_key)) ?? null } : {}),
    }));
}

/** Share of the previous step that did not continue, 0–100. */
export function dropOff(step: FunnelStep): number {
  return Math.max(0, 100 - step.pctOfPrevious);
}

/** metric_usage_heatmap() rows as a full 7 × 24 grid (ISO weekday 1 = Monday). */
export function heatmapGrid(rows: readonly Row[]): HeatmapCell[][] {
  const grid = Array.from({ length: 7 }, (_, day) =>
    Array.from({ length: 24 }, (_, hour) => ({ weekday: day + 1, hour, events: 0, users: 0 })),
  );
  for (const row of rows) {
    const weekday = num(row.weekday);
    const hour = num(row.hour);
    if (weekday === null || hour === null || weekday < 1 || weekday > 7 || hour < 0 || hour > 23) {
      continue;
    }
    grid[weekday - 1][hour] = {
      weekday,
      hour,
      events: num(row.events) ?? 0,
      users: num(row.users) ?? 0,
    };
  }
  return grid;
}
