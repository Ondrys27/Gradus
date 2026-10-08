import "server-only";
import type { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { EVENTS, type EventName } from "@/lib/analytics/events";
import { METRICS_TIMEZONE, type EventCalc } from "@/lib/analytics/metrics";
import { alignToRange, type Point } from "../numbers";
import type { AdminQuery } from "./metrics-data";
import type { ChartData, ChartRow } from "../types";
import { metricParams } from "../view-state";

/**
 * The Explorer: any catalog event, picked freely, run through the same
 * metric_event_series the registry uses — event × calculation × period ×
 * day/week/month × segment, nothing a page author chose ahead of time.
 */

export const EXPLORER_EVENTS: readonly EventName[] = Object.keys(EVENTS) as EventName[];
export const EXPLORER_CALCS: readonly EventCalc[] = ["count", "users", "sum", "avg"];
export type ExplorerGrain = "day" | "week" | "month";
export const EXPLORER_GRAINS: readonly ExplorerGrain[] = ["day", "week", "month"];

/**
 * The numeric properties of an event a sum/average can be taken of: a
 * schema that accepts a number but refuses a string accepts only numbers.
 */
export function numericPropsOf(event: EventName): string[] {
  const props: Record<string, z.ZodType> = EVENTS[event].props;
  // An amount next to a currency is money: summing or averaging it would add
  // currencies together. Money is shown per currency on the finance pages.
  const isMoney = "currency" in props;
  return Object.entries(props)
    .filter(([prop]) => !(isMoney && prop === "value"))
    .filter(([, schema]) => schema.safeParse(1).success && !schema.safeParse("1").success)
    .map(([prop]) => prop);
}

export type ExplorerQuery = {
  event: EventName;
  calc: EventCalc;
  prop: string | null;
  grain: ExplorerGrain;
};

export function isValidExplorerQuery(query: ExplorerQuery): boolean {
  if (!EXPLORER_EVENTS.includes(query.event)) return false;
  if (!EXPLORER_CALCS.includes(query.calc)) return false;
  if ((query.calc === "sum" || query.calc === "avg") && !query.prop) return false;
  if (query.prop && !numericPropsOf(query.event).includes(query.prop)) return false;
  return true;
}

export async function explorerChart(q: AdminQuery, query: ExplorerQuery): Promise<ChartData> {
  const params = metricParams(q.view, q.range);
  const { data, error } = await createAdminClient().rpc("metric_event_series", {
    _event: query.event,
    _calc: query.calc,
    _from: params.from,
    _to: params.to,
    _grain: query.grain,
    _prop: query.prop ?? undefined,
    _tz: METRICS_TIMEZONE,
    _include_internal: params.includeInternal ?? false,
    _segment: params.segment ?? {},
  });
  if (error) throw new Error(`metric_event_series: ${error.message}`);
  const points: Point[] = (data ?? []).map((row) => ({
    day: String(row.bucket),
    value: row.value === null ? null : Number(row.value),
  }));
  const aligned = query.grain === "day" ? alignToRange(points, q.range, 0) : points;
  const rows: ChartRow[] = aligned.map((point) => ({ x: point.day, value: point.value }));
  return {
    id: `explorer.${query.event}`,
    xKind: "day",
    unit: query.calc === "users" ? "users" : "count",
    series: [{ key: "value", kind: "bar", color: "violet" }],
    rows,
  };
}
