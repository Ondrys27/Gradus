import "server-only";
import { formatCalendarDate } from "@/lib/format";
import { averageCurve, cohortRows, funnelSteps, heatmapGrid } from "../cohorts";
import { ADMIN_FORMAT_SETTINGS } from "../format-metric";
import type {
  BreakdownData,
  ChartData,
  ChartRow,
  CohortRow,
  FieldsData,
  FunnelStep,
  HeatmapCell,
  TileData,
} from "../types";
import {
  breakdown,
  dailyChart,
  distribution,
  num,
  rowsOf,
  run,
  scalarTile,
  seriesTile,
  usersTile,
  type AdminQuery,
} from "./metrics-data";
import type { MetricUnit } from "@/lib/analytics/metrics";

/**
 * The blocks of the Overview, Growth, Activation and Retention pages. Every
 * number is a registry metric (docs/metrics.md); this only picks and arranges.
 */

// --- Overview --------------------------------------------------------------------

export function overviewTiles(q: AdminQuery): Promise<TileData[]> {
  return Promise.all([
    seriesTile(q, "signups", "sum"),
    seriesTile(q, "dau", "mean"),
    seriesTile(q, "wau", "last"),
    seriesTile(q, "mau", "last"),
    seriesTile(q, "stickiness", "mean"),
    scalarTile(q, "activation_rate", { spark: true }),
    scalarTile(q, "retention_d7", { spark: true }),
    seriesTile(q, "ai_cost", "sum", { lowerIsBetter: true }),
    scalarTile(q, "cost_per_active_user", { spark: true, lowerIsBetter: true }),
    scalarTile(q, "nps"),
  ]);
}

export function overviewChart(q: AdminQuery): Promise<ChartData> {
  return dailyChart(q, "overview.active", [
    { key: "dau", kind: "area", color: "violet" },
    { key: "wau", kind: "line", color: "teal" },
    { key: "mau", kind: "line", color: "gold", hidden: true },
    { key: "signups", kind: "bar", color: "green", axis: "right" },
  ]);
}

// --- Growth ------------------------------------------------------------------------

export function growthTiles(q: AdminQuery): Promise<TileData[]> {
  return Promise.all([
    seriesTile(q, "signups", "sum"),
    seriesTile(q, "users_total", "last"),
    seriesTile(q, "dau", "mean"),
    seriesTile(q, "wau", "last"),
    seriesTile(q, "mau", "last"),
    seriesTile(q, "stickiness", "mean"),
    seriesTile(q, "new_active", "sum"),
    seriesTile(q, "returning_active", "mean"),
  ]);
}

export function growthCharts(q: AdminQuery): Promise<ChartData[]> {
  return Promise.all([
    dailyChart(q, "growth.signups", [
      { key: "signups", kind: "bar", color: "violet" },
      { key: "users_total", kind: "line", color: "teal", axis: "right" },
    ]),
    dailyChart(q, "growth.active", [
      { key: "dau", kind: "line", color: "violet" },
      { key: "wau", kind: "line", color: "teal" },
      { key: "mau", kind: "line", color: "gold" },
    ]),
    dailyChart(q, "growth.new_returning", [
      { key: "new_active", kind: "bar", color: "green" },
      { key: "returning_active", kind: "bar", color: "violet" },
    ]),
    dailyChart(q, "growth.stickiness", [{ key: "stickiness", kind: "area", color: "teal" }]),
  ]);
}

/** One row of a function as named values, with the previous period when compared. */
async function fields(
  q: AdminQuery,
  key: string,
  columns: { name: string; unit: MetricUnit }[],
  compare = true,
): Promise<FieldsData> {
  const [current, previous] = await Promise.all([
    run(q, key),
    compare && q.previous ? run(q, key, q.previous) : null,
  ]);
  const now = rowsOf(current)[0] ?? {};
  const before = previous ? (rowsOf(previous)[0] ?? {}) : null;
  return {
    key,
    fields: columns.map((column) => ({
      ...column,
      value: num(now[column.name]),
      ...(before ? { previous: num(before[column.name]) } : {}),
    })),
  };
}

export function growthFields(q: AdminQuery): Promise<FieldsData[]> {
  return Promise.all([
    fields(q, "waitlist", [
      { name: "joined", unit: "count" },
      { name: "confirmed", unit: "count" },
      { name: "confirm_rate", unit: "percent" },
      { name: "converted", unit: "count" },
    ]),
    fields(q, "workers", [
      { name: "invites_sent", unit: "count" },
      { name: "invites_accepted", unit: "count" },
      { name: "invites_expired", unit: "count" },
      { name: "workers", unit: "users" },
      { name: "active_workers", unit: "users" },
      { name: "owners_with_workers", unit: "users" },
      { name: "workers_per_owner", unit: "count" },
    ]),
  ]);
}

export const GROWTH_DISTRIBUTIONS = [
  "users_by_plan",
  "users_by_industry",
  "users_by_locale",
  "users_by_country",
  "users_by_role",
  "users_by_device",
  "users_by_browser",
] as const;

export function growthDistributions(q: AdminQuery): Promise<BreakdownData[]> {
  return Promise.all(GROWTH_DISTRIBUTIONS.map((key) => distribution(q, key)));
}

// --- Activation ----------------------------------------------------------------------

export function activationTiles(q: AdminQuery): Promise<TileData[]> {
  return Promise.all([
    scalarTile(q, "activation_rate", { spark: true }),
    scalarTile(q, "time_to_value", { lowerIsBetter: true }),
    usersTile(q, "onboarding_completed"),
  ]);
}

export async function activationFunnel(q: AdminQuery): Promise<FunnelStep[]> {
  const [current, previous] = await Promise.all([
    run(q, "funnel"),
    q.previous ? run(q, "funnel", q.previous) : null,
  ]);
  return funnelSteps(rowsOf(current), previous ? rowsOf(previous) : undefined);
}

export function activationBreakdowns(q: AdminQuery): Promise<BreakdownData[]> {
  return Promise.all(
    ["onboarding_steps", "onboarding_skipped_at", "tour_outcome", "tour_skipped_at"].map((key) =>
      breakdown(q, key),
    ),
  );
}

// --- Retention -------------------------------------------------------------------------

export function retentionTiles(q: AdminQuery): Promise<TileData[]> {
  return Promise.all([
    scalarTile(q, "retention_d1"),
    scalarTile(q, "retention_d7"),
    scalarTile(q, "retention_d30"),
    seriesTile(q, "churned", "last", { lowerIsBetter: true }),
    seriesTile(q, "sessions", "sum"),
    seriesTile(q, "app_minutes", "sum"),
    usersTile(q, "returns_from_email"),
  ]);
}

/** Weeks after sign-up shown in the cohort table; the registry asks for 12. */
export const COHORT_WEEKS = 12;
/** Cohorts drawn as their own curve next to the average. */
const CURVE_COHORTS = 4;

export async function retentionCohorts(
  q: AdminQuery,
): Promise<{ cohorts: CohortRow[]; curves: ChartData }> {
  const cohorts = cohortRows(rowsOf(await run(q, "cohorts")), COHORT_WEEKS);
  const average = averageCurve(cohorts);
  const recent = cohorts.slice(-CURVE_COHORTS);
  const rows: ChartRow[] = average.map((value, week) => {
    const row: ChartRow = { x: String(week), average: value };
    for (const cohort of recent) row[`c${cohort.week}`] = cohort.cells[week] ?? null;
    return row;
  });
  const palette = ["violet", "gold", "orange", "pink"] as const;
  return {
    cohorts,
    curves: {
      id: "retention.curves",
      xKind: "week",
      unit: "percent",
      rows,
      series: [
        { key: "average", kind: "area", color: "teal", label: { key: "retention.average" } },
        ...recent.map((cohort, index) => ({
          key: `c${cohort.week}`,
          kind: "line" as const,
          color: palette[index % palette.length],
          dashed: true,
          label: {
            key: "retention.cohortOf",
            values: {
              week: formatCalendarDate(cohort.week, ADMIN_FORMAT_SETTINGS),
            },
          },
        })),
      ],
    },
  };
}

export function retentionCharts(q: AdminQuery): Promise<ChartData[]> {
  return Promise.all([
    dailyChart(q, "retention.sessions", [
      { key: "sessions", kind: "bar", color: "violet" },
      { key: "app_minutes", kind: "line", color: "teal", axis: "right" },
    ]),
    dailyChart(q, "retention.churned", [{ key: "churned", kind: "line", color: "pink" }]),
  ]);
}

export function retentionSessions(q: AdminQuery): Promise<FieldsData> {
  return fields(q, "session_stats", [
    { name: "sessions_per_user_day", unit: "count" },
    { name: "sessions_per_user_week", unit: "count" },
    { name: "median_minutes", unit: "minutes" },
    { name: "p90_minutes", unit: "minutes" },
    { name: "minutes_per_user_day", unit: "minutes" },
  ]);
}

export async function retentionActiveDays(q: AdminQuery): Promise<BreakdownData> {
  const rows = rowsOf(await run(q, "active_days_per_week"));
  const byDays = new Map(rows.map((row) => [num(row.days), num(row.user_weeks)]));
  return {
    key: "active_days_per_week",
    unit: "count",
    items: Array.from({ length: 7 }, (_, index) => ({
      key: String(index + 1),
      value: byDays.get(index + 1) ?? 0,
    })),
  };
}

export async function retentionHeatmap(q: AdminQuery): Promise<HeatmapCell[][]> {
  return heatmapGrid(rowsOf(await run(q, "usage_heatmap")));
}

export function retentionBreakdowns(q: AdminQuery): Promise<BreakdownData[]> {
  return Promise.all([breakdown(q, "returns_from_jarvis")]);
}
