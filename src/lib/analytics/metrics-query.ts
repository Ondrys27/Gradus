import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { DailyMetricKey } from "./metrics";
import {
  combineMetric,
  planMetric,
  requireMetric,
  type MetricParams,
  type MetricResult,
} from "./metrics-plan";

type Admin = SupabaseClient<Database>;
type Row = Record<string, unknown>;
type LooseRpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{
  data: unknown;
  error: { message: string; code?: string } | null;
}>;

/**
 * Computes metrics from the registry with the admin client. Only for server
 * code of the administration, after the owner and the second factor have been
 * checked: the functions see every account (the service role bypasses RLS)
 * and return counts, never content.
 */
async function call(admin: Admin, fn: string, args: Record<string, unknown>): Promise<Row[]> {
  const rpc = admin.rpc.bind(admin) as unknown as LooseRpc;
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  if (Array.isArray(data)) return data as Row[];
  return data === null || data === undefined ? [] : [{ value: data }];
}

export async function runMetric(
  admin: Admin,
  key: string,
  params: MetricParams,
): Promise<MetricResult> {
  const definition = requireMetric(key);
  const calls = planMetric(definition, params);
  const results = await Promise.all(calls.map(({ fn, args }) => call(admin, fn, args)));
  return combineMetric(definition, params, results);
}

/**
 * Several daily metrics in one call (the overview): finished days come from
 * metrics_daily, today is computed live.
 */
export async function loadDailySeries(
  admin: Admin,
  metrics: readonly DailyMetricKey[],
  params: MetricParams,
): Promise<Record<string, { day: string; value: number | null }[]>> {
  const { data, error } = await admin.rpc("metric_series", {
    _metrics: [...metrics],
    _from: params.from,
    _to: params.to,
    _tz: params.tz,
    _include_internal: params.includeInternal ?? false,
    _segment: params.segment ?? {},
  });
  if (error) throw new Error(`metric_series: ${error.message}`);
  const series: Record<string, { day: string; value: number | null }[]> = {};
  for (const metric of metrics) series[metric] = [];
  for (const row of data ?? []) {
    series[row.metric_key]?.push({
      day: row.day,
      value: row.value === null ? null : Number(row.value),
    });
  }
  return series;
}
