import "server-only";
import { cache } from "react";
import type { IsoDate } from "@/lib/format";
import { metricDefinition, metricsToday, type MetricUnit } from "@/lib/analytics/metrics";
import type { MetricParams, MetricResult } from "@/lib/analytics/metrics-plan";
import { runMetric } from "@/lib/analytics/metrics-query";
import { createAdminClient } from "@/lib/supabase/admin";
import { aggregate, alignToRange, splitRange, type Aggregate, type Point } from "../numbers";
import type { BreakdownData, ChartData, ChartRow, ChartSeries, Loaded, TileData } from "../types";
import {
  metricParams,
  parseAdminView,
  previousRange,
  resolveRange,
  type AdminView,
  type DateRange,
} from "../view-state";

/**
 * Reads the numbers of the administration pages, only through the metric
 * registry (runMetric). Server code after requireAdmin(): the admin client
 * sees every account, the functions return counts, never content.
 */

export type AdminQuery = {
  view: AdminView;
  range: DateRange;
  /** The period before, when the comparison is on. */
  previous: DateRange | null;
  today: IsoDate;
};

export function adminQuery(
  searchParams: Record<string, string | string[] | undefined>,
): AdminQuery {
  const view = parseAdminView(searchParams);
  const today = metricsToday();
  const range = resolveRange(view, today);
  return { view, range, previous: view.compare ? previousRange(range) : null, today };
}

/** A block that fails shows a note; the rest of the page still loads. */
export async function safe<T>(label: string, load: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await load() };
  } catch (error) {
    console.error(`[admin] ${label} failed`, error instanceof Error ? error.message : error);
    return { ok: false };
  }
}

/**
 * One registry metric for one range. Cached per request, so blocks of a page
 * that need the same numbers share one database call.
 */
const runCached = cache(
  (key: string, from: IsoDate, to: IsoDate, internal: boolean, segment: string, grain: string) =>
    runMetric(createAdminClient(), key, {
      from,
      to,
      includeInternal: internal,
      segment: JSON.parse(segment) as MetricParams["segment"],
      grain: grain as MetricParams["grain"],
    }),
);

export function run(
  q: AdminQuery,
  key: string,
  range: DateRange = q.range,
  grain: MetricParams["grain"] = "day",
): Promise<MetricResult> {
  const params = metricParams(q.view, range);
  return runCached(
    key,
    params.from,
    params.to,
    params.includeInternal ?? false,
    JSON.stringify(params.segment ?? {}),
    grain ?? "day",
  );
}

export function unitOf(key: string): MetricUnit {
  const definition = metricDefinition(key);
  if (!definition) throw new Error(`Unknown metric ${key}`);
  return definition.unit;
}

export function pointsOf(result: MetricResult): Point[] {
  return result.kind === "series" ? result.points : [];
}

export function valueOf(result: MetricResult): number | null {
  if (result.kind === "value") return result.value;
  if (result.kind === "series") return aggregate(result.points, "sum");
  return null;
}

export function rowsOf(result: MetricResult): Record<string, unknown>[] {
  return result.kind === "rows" ? result.rows : [];
}

export function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Daily metrics are complete for every day; event series leave quiet days out. */
function fillFor(key: string): number | null {
  return metricDefinition(key)?.compute.kind === "daily" ? null : 0;
}

/** A tile of a daily metric (or an event series): its days aggregated. */
export async function seriesTile(
  q: AdminQuery,
  key: string,
  how: Aggregate,
  options: { lowerIsBetter?: boolean } = {},
): Promise<TileData> {
  const [current, previous] = await Promise.all([
    run(q, key),
    q.previous ? run(q, key, q.previous) : null,
  ]);
  const points = alignToRange(pointsOf(current), q.range, fillFor(key));
  return {
    key,
    unit: unitOf(key),
    value: aggregate(points, how),
    ...(previous
      ? { previous: aggregate(alignToRange(pointsOf(previous), q.previous!, fillFor(key)), how) }
      : {}),
    spark: points.map((point) => point.value),
    ...options,
  };
}

/**
 * A tile of distinct users of an event over the whole range (summing daily
 * uniques would count a person twice); the small chart shows the days.
 */
export async function usersTile(q: AdminQuery, key: string): Promise<TileData> {
  const [total, daily, previous] = await Promise.all([
    run(q, key, q.range, "all"),
    run(q, key),
    q.previous ? run(q, key, q.previous, "all") : null,
  ]);
  const value = (result: MetricResult) => aggregate(pointsOf(result), "sum") ?? 0;
  return {
    key,
    unit: unitOf(key),
    value: value(total),
    ...(previous ? { previous: value(previous) } : {}),
    spark: alignToRange(pointsOf(daily), q.range, 0).map((point) => point.value),
  };
}

/**
 * A tile of a number that exists only for a whole range (a share, a median,
 * a cost per user). The small chart, when asked for, recomputes it for up to
 * six parts of the range.
 */
export async function scalarTile(
  q: AdminQuery,
  key: string,
  options: { spark?: boolean; lowerIsBetter?: boolean } = {},
): Promise<TileData> {
  const definition = metricDefinition(key);
  if (definition?.compute.kind === "pending") {
    return { key, unit: definition.unit, value: null, pending: definition.compute.step };
  }
  const parts = options.spark ? splitRange(q.range, 6) : [];
  const [current, previous, ...spark] = await Promise.all([
    run(q, key),
    q.previous ? run(q, key, q.previous) : null,
    ...(parts.length > 1 ? parts.map((part) => run(q, key, part)) : []),
  ]);
  return {
    key,
    unit: unitOf(key),
    value: valueOf(current),
    ...(previous ? { previous: valueOf(previous) } : {}),
    ...(spark.length > 1 ? { spark: spark.map((result) => valueOf(result)) } : {}),
    ...(options.lowerIsBetter ? { lowerIsBetter: true } : {}),
  };
}

/** A breakdown metric (one event split by a property), with the previous period. */
export async function breakdown(q: AdminQuery, key: string): Promise<BreakdownData> {
  const [current, previous] = await Promise.all([
    run(q, key),
    q.previous ? run(q, key, q.previous) : null,
  ]);
  const before = new Map(
    previous?.kind === "breakdown" ? previous.rows.map((row) => [row.key, row.value]) : [],
  );
  return {
    key,
    unit: unitOf(key),
    items: (current.kind === "breakdown" ? current.rows : []).map((row) => ({
      key: row.key,
      value: row.value,
      ...(previous ? { previous: before.get(row.key) ?? null } : {}),
    })),
  };
}

/** Accounts split by an attribute now: a snapshot, nothing to compare with. */
export async function distribution(q: AdminQuery, key: string): Promise<BreakdownData> {
  const result = await run(q, key);
  return {
    key,
    unit: unitOf(key),
    items: rowsOf(result).map((row) => ({
      key: String(row.key),
      value: num(row.users) ?? num(row.value),
    })),
  };
}

/**
 * A day-by-day chart of registry metrics. Every series is one metric; rows
 * are every day of the range.
 */
export async function dailyChart(
  q: AdminQuery,
  id: string,
  series: ChartSeries[],
): Promise<ChartData> {
  const results = await Promise.all(series.map((s) => run(q, s.key)));
  const aligned = series.map((s, index) =>
    alignToRange(pointsOf(results[index]), q.range, fillFor(s.key)),
  );
  const rows: ChartRow[] = aligned[0].map((point, dayIndex) => {
    const row: ChartRow = { x: point.day };
    series.forEach((s, index) => {
      row[s.key] = aligned[index][dayIndex].value;
    });
    return row;
  });
  const leftUnit = series.find((s) => s.axis !== "right") ?? series[0];
  const right = series.find((s) => s.axis === "right");
  return {
    id,
    xKind: "day",
    unit: unitOf(leftUnit.key),
    ...(right ? { rightUnit: unitOf(right.key) } : {}),
    series,
    rows,
  };
}

/**
 * The industries and countries the accounts have, for the segment choice.
 * From the registry's distributions over all accounts, internal included, so
 * the list does not change with the view.
 */
export async function openSegmentValues(): Promise<{ industry: string[]; country: string[] }> {
  const today = metricsToday();
  const params = { from: today, to: today, includeInternal: true, segment: {} };
  const admin = createAdminClient();
  const [industry, country] = await Promise.all([
    runMetric(admin, "users_by_industry", params),
    runMetric(admin, "users_by_country", params),
  ]);
  const keys = (result: MetricResult) =>
    rowsOf(result)
      .map((row) => String(row.key))
      .filter((key) => key !== "none");
  return { industry: keys(industry), country: keys(country) };
}
