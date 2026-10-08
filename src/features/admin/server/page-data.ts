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
import { autoBreakdowns, autoTiles } from "./auto-metrics";
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
import { metricsIn, type MetricUnit } from "@/lib/analytics/metrics";
import type { AnalyticsSection } from "@/lib/analytics/routes";

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
export async function fields(
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

// --- Features ----------------------------------------------------------------------

/** The app sections the Features page offers as tabs, in the order of docs/metrics.md. */
export const FEATURE_SECTIONS = [
  "milestones",
  "pipeline",
  "contacts",
  "generation",
  "cold_calling",
  "calendar",
  "finance",
  "workers",
  "search",
  "email",
  "settings",
] as const satisfies readonly AnalyticsSection[];

/**
 * The metric whose daily count stands for a section's trend chart: one of
 * its metrics that is a plain series, not a breakdown. Milestones, calendar
 * and settings have none simple enough, so they show none.
 */
const SECTION_TREND: Partial<Record<AnalyticsSection, string>> = {
  pipeline: "deals_created",
  contacts: "contact_moves",
  generation: "generation_batches",
  cold_calling: "timer_sessions",
  finance: "invoices_issued",
  workers: "worker_tasks_assigned",
  search: "searches",
  email: "emails_sent",
};

export type AdoptionRow = {
  section: string;
  users: number | null;
  activeUsers: number | null;
  pct: number | null;
  actions: number | null;
  actionsPerUser: number | null;
};

/** Adoption, actions and actions per user of every section, one row each. */
export async function featureAdoption(q: AdminQuery): Promise<AdoptionRow[]> {
  const rows = rowsOf(await run(q, "feature_adoption"));
  return rows.map((row) => ({
    section: String(row.section),
    users: num(row.users),
    activeUsers: num(row.active_users),
    pct: num(row.pct),
    actions: num(row.actions),
    actionsPerUser: num(row.actions_per_user),
  }));
}

function sectionKeys(section: AnalyticsSection): string[] {
  return metricsIn("features")
    .filter((definition) => definition.section === section)
    .map((definition) => definition.key);
}

export async function featureSectionTiles(
  q: AdminQuery,
  section: AnalyticsSection,
): Promise<TileData[]> {
  return autoTiles(q, sectionKeys(section));
}

export async function featureSectionBreakdowns(
  q: AdminQuery,
  section: AnalyticsSection,
): Promise<BreakdownData[]> {
  return autoBreakdowns(q, sectionKeys(section));
}

export async function featureSectionTrend(
  q: AdminQuery,
  section: AnalyticsSection,
): Promise<ChartData | null> {
  const key = SECTION_TREND[section];
  if (!key) return null;
  return dailyChart(q, `features.${section}`, [{ key, kind: "bar", color: "violet" }]);
}

/** milestone_days_to_complete, grouped by whether the milestone came from a path template. */
export async function milestoneDaysToComplete(
  q: AdminQuery,
): Promise<{ key: string; p50: number | null }[]> {
  const rows = rowsOf(await run(q, "milestone_days_to_complete"));
  return rows.map((row) => ({ key: String(row.key), p50: num(row.p50) }));
}

export type MoneyRow = { metric: string; currency: string; items: number | null; total: number | null };

async function moneyRows(q: AdminQuery, key: string): Promise<MoneyRow[]> {
  const rows = rowsOf(await run(q, key));
  return rows.map((row) => ({
    metric: String(row.metric),
    currency: String(row.currency),
    items: num(row.items),
    total: num(row.total),
  }));
}

export const dealValue = (q: AdminQuery) => moneyRows(q, "deal_value");
export const financeValue = (q: AdminQuery) => moneyRows(q, "finance_value");

export const callTimeFields = (q: AdminQuery) =>
  fields(q, "call_time", [
    { name: "hours", unit: "hours" },
    { name: "callers", unit: "users" },
    { name: "hours_per_caller", unit: "hours" },
    { name: "meetings", unit: "count" },
    { name: "meetings_per_hour", unit: "ratio" },
  ]);

export async function generationKeywords(
  q: AdminQuery,
): Promise<{ keyword: string; searches: number | null }[]> {
  const rows = rowsOf(await run(q, "generation_keywords"));
  return rows.map((row) => ({ keyword: String(row.keyword), searches: num(row.searches) }));
}

export const workerInviteFields = (q: AdminQuery) =>
  fields(q, "worker_invites", [
    { name: "invites_sent", unit: "count" },
    { name: "invites_accepted", unit: "count" },
    { name: "invites_expired", unit: "count" },
    { name: "workers", unit: "users" },
    { name: "active_workers", unit: "users" },
    { name: "owners_with_workers", unit: "users" },
    { name: "workers_per_owner", unit: "count" },
  ]);

// --- AI and Jarvis -------------------------------------------------------------------

export const AI_TILE_KEYS = [
  "ai_calls",
  "ai_cost",
  "ai_cost_per_active_user",
  "ai_cap_users",
  "jarvis_auto_actions_undone",
  "jarvis_file_size",
] as const;

export function aiTiles(q: AdminQuery): Promise<TileData[]> {
  return autoTiles(q, AI_TILE_KEYS);
}

export const AI_BREAKDOWN_KEYS = [
  "proactive_reactions",
  "proactive_acceptance",
  "jarvis_auto_actions",
  "jarvis_answer_ratings",
  "jarvis_files",
  "jarvis_files_rejected",
] as const;

export function aiBreakdowns(q: AdminQuery): Promise<BreakdownData[]> {
  return autoBreakdowns(q, AI_BREAKDOWN_KEYS);
}

export function aiCostChart(q: AdminQuery): Promise<ChartData> {
  return dailyChart(q, "ai.cost", [{ key: "ai_cost", kind: "area", color: "violet" }]);
}

export type AiUsageRow = {
  key: string;
  calls: number | null;
  failed: number | null;
  users: number | null;
  inputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
};

async function aiUsageRows(q: AdminQuery, key: "ai_by_feature" | "ai_by_model"): Promise<AiUsageRow[]> {
  const rows = rowsOf(await run(q, key));
  return rows.map((row) => ({
    key: String(row.key),
    calls: num(row.calls),
    failed: num(row.failed),
    users: num(row.users),
    inputTokens: num(row.input_tokens),
    cacheReadTokens: num(row.cache_read_tokens),
    cacheWriteTokens: num(row.cache_write_tokens),
    outputTokens: num(row.output_tokens),
    costUsd: num(row.cost_usd),
    p50Ms: num(row.p50_ms),
    p95Ms: num(row.p95_ms),
  }));
}

export const aiByFeature = (q: AdminQuery) => aiUsageRows(q, "ai_by_feature");
export const aiByModel = (q: AdminQuery) => aiUsageRows(q, "ai_by_model");

export async function aiErrors(q: AdminQuery): Promise<{ key: string; calls: number | null }[]> {
  const rows = rowsOf(await run(q, "ai_errors"));
  return rows.map((row) => ({ key: String(row.key), calls: num(row.calls) }));
}

export type AiTopUser = { userId: string; plan: string; calls: number | null; costUsd: number | null };

export async function aiTopUsers(q: AdminQuery): Promise<AiTopUser[]> {
  const rows = rowsOf(await run(q, "ai_top_users"));
  return rows.map((row) => ({
    userId: String(row.user_id),
    plan: String(row.plan ?? ""),
    calls: num(row.calls),
    costUsd: num(row.cost_usd),
  }));
}

export const jarvisConversations = (q: AdminQuery) =>
  fields(q, "jarvis_conversations", [
    { name: "conversations", unit: "count" },
    { name: "users", unit: "users" },
    { name: "user_messages", unit: "count" },
    { name: "messages_per_user", unit: "count" },
    { name: "median_messages_per_conversation", unit: "count" },
  ]);

// --- Game --------------------------------------------------------------------------

export const GAME_TILE_KEYS = ["streak_freezes"] as const;

export function gameTiles(q: AdminQuery): Promise<TileData[]> {
  return autoTiles(q, GAME_TILE_KEYS);
}

export const GAME_BREAKDOWN_KEYS = [
  "users_by_mode",
  "mode_switches",
  "level_distribution",
  "chapters_completed",
  "unlock_days",
  "achievements",
  "streaks",
  "celebrations",
] as const;

export function gameBreakdowns(q: AdminQuery): Promise<BreakdownData[]> {
  return autoBreakdowns(q, GAME_BREAKDOWN_KEYS);
}

export function gameChart(q: AdminQuery): Promise<ChartData> {
  return dailyChart(q, "game.xp", [{ key: "xp_per_day", kind: "area", color: "gold" }]);
}

export async function xpSources(q: AdminQuery): Promise<BreakdownData> {
  return breakdown(q, "xp_sources");
}

// --- Costs -------------------------------------------------------------------------

export function costsTiles(q: AdminQuery): Promise<TileData[]> {
  return Promise.all([
    seriesTile(q, "ai_cost", "sum", { lowerIsBetter: true }),
    seriesTile(q, "places_requests", "sum"),
    scalarTile(q, "cost_per_active_user", { spark: true, lowerIsBetter: true }),
  ]);
}

export async function costBreakdownFields(q: AdminQuery): Promise<FieldsData> {
  return fields(q, "cost_breakdown", [
    { name: "ai_usd", unit: "usd" },
    { name: "places_usd", unit: "usd" },
    { name: "emails_usd", unit: "usd" },
    { name: "total_usd", unit: "usd" },
    { name: "total_czk", unit: "czk" },
  ]);
}

export type MarginRow = {
  plan: string;
  priceCzk: number | null;
  costPerActiveUserCzk: number | null;
  marginCzk: number | null;
  marginShare: number | null;
};

/** Cost per active user next to the plan's price and estimated margin. */
export async function marginByPlanRows(q: AdminQuery): Promise<MarginRow[]> {
  const rows = rowsOf(await run(q, "margin_by_plan"));
  return rows.map((row) => ({
    plan: String(row.plan),
    priceCzk: num(row.price_czk),
    costPerActiveUserCzk: num(row.cost_per_active_user_czk),
    marginCzk: num(row.margin_czk),
    marginShare: num(row.margin_share),
  }));
}

export const trialFields = (q: AdminQuery) =>
  fields(
    q,
    "trials",
    [
      { name: "running", unit: "count" },
      { name: "ending_this_week", unit: "count" },
      { name: "expired", unit: "count" },
      { name: "converted", unit: "count" },
    ],
    false,
  );

export function costsBreakdowns(q: AdminQuery): Promise<BreakdownData[]> {
  return autoBreakdowns(q, ["plan_interest"]);
}

// --- Technical health ----------------------------------------------------------------

export const HEALTH_TILE_KEYS = ["errors", "server_error_rate"] as const;

export function healthTiles(q: AdminQuery): Promise<TileData[]> {
  return autoTiles(q, HEALTH_TILE_KEYS);
}

export const HEALTH_BREAKDOWN_KEYS = [
  "top_server_errors",
  "client_errors_by_page",
  "integration_errors",
] as const;

export function healthBreakdowns(q: AdminQuery): Promise<BreakdownData[]> {
  return autoBreakdowns(q, HEALTH_BREAKDOWN_KEYS);
}

export function healthChart(q: AdminQuery): Promise<ChartData> {
  return dailyChart(q, "health.errors", [{ key: "errors", kind: "bar", color: "pink" }]);
}

export type LatencyRow = { key: string; n: number | null; p50: number | null; p95: number | null };

async function latencyRows(q: AdminQuery, key: string): Promise<LatencyRow[]> {
  const rows = rowsOf(await run(q, key));
  return rows.map((row) => ({
    key: String(row.key || "–"),
    n: num(row.n),
    p50: num(row.p50),
    p95: num(row.p95),
  }));
}

export const routeLatency = (q: AdminQuery) => latencyRows(q, "route_latency");
export const pageLoad = (q: AdminQuery) => latencyRows(q, "page_load");

export type CronRow = {
  job: string;
  lastRunAt: string | null;
  lastOk: boolean | null;
  lastDurationMs: number | null;
  runs7d: number | null;
  failures7d: number | null;
};

/** Takes no range or segment: every job's very last run and its last 7 days. */
export async function cronRuns(q: AdminQuery): Promise<CronRow[]> {
  const rows = rowsOf(await run(q, "cron_runs"));
  return rows.map((row) => ({
    job: String(row.job),
    lastRunAt: row.last_run_at ? String(row.last_run_at) : null,
    lastOk: typeof row.last_ok === "boolean" ? row.last_ok : null,
    lastDurationMs: num(row.last_duration_ms),
    runs7d: num(row.runs_7d),
    failures7d: num(row.failures_7d),
  }));
}
