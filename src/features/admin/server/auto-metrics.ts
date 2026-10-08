import "server-only";
import { metricDefinition } from "@/lib/analytics/metrics";
import type { BreakdownData, TileData } from "../types";
import {
  breakdown,
  distribution,
  num,
  rowsOf,
  run,
  scalarTile,
  seriesTile,
  unitOf,
  usersTile,
  type AdminQuery,
} from "./metrics-data";

/**
 * Renders any registry metric by its compute kind, so a page lists keys
 * instead of hand-building every tile: `daily` / `event` / `ratio` /
 * `function` with a `pick` / `pending` become a tile, `breakdown` /
 * `breakdown_ratio` / `distribution` a breakdown list, an ungrouped
 * `percentiles` a tile of its median. Everything else (a grouped
 * percentiles, a bare `function`, `money`, `cost`) is a small table a page
 * builds by hand — there are only a handful of those across the app.
 */

/** Metrics where a smaller number is the good outcome (costs, errors, churn…). */
const LOWER_IS_BETTER = new Set<string>([
  "generation_errors",
  "generation_error_rate",
  "generation_daily_cap",
  "generation_monthly_cap",
  "duplicates_caught",
  "timer_auto_pauses",
  "reached_to_failed",
  "calendar_sync_errors",
  "search_no_results",
  "errors",
  "server_error_rate",
  "top_server_errors",
  "client_errors_by_page",
  "churned",
  "ai_cost",
  "ai_cost_per_active_user",
  "jarvis_auto_actions_undone",
  "jarvis_files_rejected",
  "ai_cap_users",
  "ai_errors",
  "cost_breakdown",
  "cost_per_active_user",
  "streak_freezes",
  "integration_errors",
]);

export async function autoTile(q: AdminQuery, key: string): Promise<TileData | null> {
  const definition = metricDefinition(key);
  if (!definition) return null;
  const lowerIsBetter = LOWER_IS_BETTER.has(key);
  const c = definition.compute;
  switch (c.kind) {
    case "daily":
      return seriesTile(q, key, "sum", { lowerIsBetter });
    case "event":
      return c.calc === "users" ? usersTile(q, key) : seriesTile(q, key, "sum", { lowerIsBetter });
    case "ratio":
    case "pending":
      return scalarTile(q, key, { lowerIsBetter });
    case "function":
      return c.pick ? scalarTile(q, key, { lowerIsBetter }) : null;
    case "percentiles":
      return c.by ? null : percentileTile(q, key, "p50", { lowerIsBetter });
    default:
      return null;
  }
}

export async function autoTiles(q: AdminQuery, keys: readonly string[]): Promise<TileData[]> {
  const tiles = await Promise.all(keys.map((key) => autoTile(q, key)));
  return tiles.filter((tile): tile is TileData => tile !== null);
}

export async function autoBreakdown(q: AdminQuery, key: string): Promise<BreakdownData | null> {
  const definition = metricDefinition(key);
  if (!definition) return null;
  switch (definition.compute.kind) {
    case "breakdown":
    case "breakdown_ratio":
      return breakdown(q, key);
    case "distribution":
      return distribution(q, key);
    default:
      return null;
  }
}

export async function autoBreakdowns(
  q: AdminQuery,
  keys: readonly string[],
): Promise<BreakdownData[]> {
  const items = await Promise.all(keys.map((key) => autoBreakdown(q, key)));
  return items.filter((item): item is BreakdownData => item !== null);
}

/** A tile of one field of an ungrouped `percentiles` metric (p50 by default). */
export async function percentileTile(
  q: AdminQuery,
  key: string,
  field: "p50" | "p90" | "p95" | "average" = "p50",
  options: { lowerIsBetter?: boolean } = {},
): Promise<TileData> {
  const [current, previous] = await Promise.all([
    run(q, key),
    q.previous ? run(q, key, q.previous) : null,
  ]);
  const value = (result: Awaited<ReturnType<typeof run>>) => num(rowsOf(result)[0]?.[field]);
  return {
    key,
    unit: unitOf(key),
    value: value(current),
    ...(previous ? { previous: value(previous) } : {}),
    ...options,
  };
}
