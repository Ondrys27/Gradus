import {
  COST_RATES,
  costBreakdown,
  costPerActiveUser,
  marginByPlan,
  type CostRates,
  type PlanCostInputs,
} from "@/config/costs";
import type { IsoDate } from "@/lib/format";
import {
  METRICS_TIMEZONE,
  daysBetween,
  metricDefinition,
  segmentFor,
  type EventQuery,
  type MetricDefinition,
  type MetricFunction,
  type Segment,
} from "./metrics";

/**
 * How a registry entry turns into calls of the SQL functions and how their
 * rows become the result the administration shows. Pure, so it is tested
 * without a database; metrics-query.ts runs the calls with the admin client.
 */

export type MetricParams = {
  from: IsoDate;
  to: IsoDate;
  /** Internal accounts count only when switched on in the administration. */
  includeInternal?: boolean;
  segment?: Segment;
  /** Buckets of event series. */
  grain?: "day" | "week" | "month";
  tz?: string;
};

export type RpcCall = { fn: string; args: Record<string, unknown> };

type Row = Record<string, unknown>;

export type MetricResult =
  | { kind: "series"; points: { day: IsoDate; value: number | null }[] }
  | { kind: "value"; value: number | null }
  | { kind: "breakdown"; rows: { key: string; value: number | null }[] }
  | { kind: "rows"; rows: Row[] }
  | { kind: "pending"; step: string };

/** Which of the shared parameters each dedicated function takes. */
const FUNCTION_PARAMS: Record<
  MetricFunction,
  { range: boolean; tz: boolean; internal: boolean; segment: boolean }
> = {
  metric_funnel: { range: true, tz: true, internal: true, segment: true },
  metric_activation: { range: true, tz: true, internal: true, segment: true },
  metric_cohorts: { range: true, tz: true, internal: true, segment: true },
  metric_retention: { range: true, tz: true, internal: true, segment: true },
  metric_usage_heatmap: { range: true, tz: true, internal: true, segment: true },
  metric_active_days: { range: true, tz: true, internal: true, segment: true },
  metric_sessions: { range: true, tz: true, internal: true, segment: true },
  metric_adoption: { range: true, tz: true, internal: true, segment: true },
  metric_ai_usage: { range: true, tz: true, internal: true, segment: true },
  metric_ai_top_users: { range: true, tz: true, internal: true, segment: true },
  metric_jarvis_conversations: { range: true, tz: true, internal: true, segment: true },
  metric_call_time: { range: true, tz: true, internal: true, segment: true },
  metric_trials: { range: false, tz: true, internal: true, segment: false },
  metric_waitlist: { range: true, tz: true, internal: false, segment: false },
  metric_workers: { range: true, tz: true, internal: true, segment: false },
  metric_cron_runs: { range: false, tz: false, internal: false, segment: false },
  metric_generation_keywords: { range: true, tz: false, internal: false, segment: false },
};

function common(definition: MetricDefinition, params: MetricParams) {
  return {
    _from: params.from,
    _to: params.to,
    _tz: params.tz ?? METRICS_TIMEZONE,
    _include_internal: params.includeInternal ?? false,
    _segment: segmentFor(definition, params.segment ?? {}),
  };
}

function eventCall(
  query: EventQuery,
  base: ReturnType<typeof common>,
  grain: "day" | "week" | "month" | "all",
): RpcCall {
  return {
    fn: "metric_event_series",
    args: {
      ...base,
      _event: query.event,
      _calc: query.calc,
      _grain: grain,
      _prop: query.prop ?? null,
      _filter: query.filter ?? {},
    },
  };
}

function breakdownCall(
  query: EventQuery,
  by: string,
  base: ReturnType<typeof common>,
  limit?: number,
): RpcCall {
  return {
    fn: "metric_event_breakdown",
    args: {
      ...base,
      _event: query.event,
      _by: by,
      _calc: query.calc,
      _prop: query.prop ?? null,
      _filter: query.filter ?? {},
      ...(limit ? { _limit: limit } : {}),
    },
  };
}

/** The calls one metric needs, in the order combineMetric() expects their rows. */
export function planMetric(definition: MetricDefinition, params: MetricParams): RpcCall[] {
  const base = common(definition, params);
  const c = definition.compute;
  switch (c.kind) {
    case "daily":
      return [{ fn: "metric_series", args: { ...base, _metrics: [c.metric] } }];
    case "event":
      return [eventCall(c, base, params.grain ?? "day")];
    case "breakdown":
      return [breakdownCall(c, c.by, base, c.limit)];
    case "percentiles":
      return [
        {
          fn: "metric_event_percentiles",
          args: {
            ...base,
            _event: c.event,
            _prop: c.prop,
            _by: c.by ?? null,
            _filter: c.filter ?? {},
          },
        },
      ];
    case "ratio":
      return [c.numerator, ...c.denominator].map((query) => eventCall(query, base, "all"));
    case "breakdown_ratio":
      return [breakdownCall(c.numerator, c.by, base), breakdownCall(c.denominator, c.by, base)];
    case "function": {
      const shape = FUNCTION_PARAMS[c.fn];
      const args: Record<string, unknown> = { ...(c.args ?? {}) };
      if (shape.range) Object.assign(args, { _from: base._from, _to: base._to });
      if (shape.tz) args._tz = base._tz;
      if (shape.internal) args._include_internal = base._include_internal;
      if (shape.segment) args._segment = base._segment;
      return [{ fn: c.fn, args }];
    }
    case "distribution":
      return [
        {
          fn: "metric_distribution",
          args: {
            _kind: c.of,
            _tz: base._tz,
            _include_internal: base._include_internal,
            _segment: base._segment,
          },
        },
      ];
    case "money":
      return [{ fn: "metric_money_by_currency", args: base }];
    case "cost":
      return [{ fn: "metric_cost_inputs", args: base }];
    case "pending":
      return [];
  }
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function total(rows: Row[] | undefined): number {
  return (rows ?? []).reduce((sum, row) => sum + (num(row.value) ?? 0), 0);
}

function costInputs(rows: Row[]): PlanCostInputs[] {
  return rows.map((row) => ({
    plan: String(row.plan),
    activeUsers: num(row.active_users) ?? 0,
    aiCostUsd: num(row.ai_cost_usd) ?? 0,
    placesRequests: num(row.places_requests) ?? 0,
    emailsSent: num(row.emails_sent) ?? 0,
  }));
}

function sumInputs(rows: PlanCostInputs[]) {
  return rows.reduce(
    (sum, row) => ({
      activeUsers: sum.activeUsers + row.activeUsers,
      aiCostUsd: sum.aiCostUsd + row.aiCostUsd,
      placesRequests: sum.placesRequests + row.placesRequests,
      emailsSent: sum.emailsSent + row.emailsSent,
    }),
    { activeUsers: 0, aiCostUsd: 0, placesRequests: 0, emailsSent: 0 },
  );
}

/** Turns the rows of planMetric()'s calls into the metric's result. */
export function combineMetric(
  definition: MetricDefinition,
  params: MetricParams,
  results: Row[][],
  rates: CostRates = COST_RATES,
): MetricResult {
  const c = definition.compute;
  const [first = []] = results;
  switch (c.kind) {
    case "daily":
      return {
        kind: "series",
        points: first.map((row) => ({ day: String(row.day), value: num(row.value) })),
      };
    case "event":
      return {
        kind: "series",
        points: first.map((row) => ({ day: String(row.bucket), value: num(row.value) })),
      };
    case "breakdown":
      return {
        kind: "breakdown",
        rows: first.map((row) => ({ key: String(row.key), value: num(row.value) })),
      };
    case "ratio": {
      const numerator = total(results[0]);
      const denominator = results.slice(1).reduce((sum, rows) => sum + total(rows), 0);
      return { kind: "value", value: denominator > 0 ? numerator / denominator : null };
    }
    case "breakdown_ratio": {
      const numerators = new Map(
        (results[0] ?? []).map((row) => [String(row.key), num(row.value) ?? 0]),
      );
      return {
        kind: "breakdown",
        rows: (results[1] ?? []).map((row) => {
          const denominator = num(row.value) ?? 0;
          const key = String(row.key);
          return {
            key,
            value: denominator > 0 ? (numerators.get(key) ?? 0) / denominator : null,
          };
        }),
      };
    }
    case "function": {
      if (!c.pick) return { kind: "rows", rows: first };
      const where = c.pick.where ?? {};
      const row = first.find((candidate) =>
        Object.entries(where).every(([key, value]) => String(candidate[key]) === String(value)),
      );
      return { kind: "value", value: row ? num(row[c.pick.field]) : null };
    }
    case "percentiles":
    case "distribution":
      return { kind: "rows", rows: first };
    case "money":
      // One row per metric and currency; amounts in different currencies stay apart.
      return { kind: "rows", rows: first.filter((row) => c.metrics.includes(row.metric as never)) };
    case "cost": {
      const plans = costInputs(first);
      const all = sumInputs(plans);
      switch (c.measure) {
        case "breakdown":
          return { kind: "rows", rows: [{ ...costBreakdown(all, rates) }] };
        case "per_active_user":
          return { kind: "value", value: costPerActiveUser(all, rates)?.usd ?? null };
        case "ai_per_active_user":
          return {
            kind: "value",
            value: all.activeUsers > 0 ? all.aiCostUsd / all.activeUsers : null,
          };
        case "margin_by_plan": {
          const periodDays = daysBetween(params.from, params.to).length;
          return { kind: "rows", rows: marginByPlan(plans, periodDays, rates) };
        }
      }
      break;
    }
    case "pending":
      return { kind: "pending", step: c.step };
  }
  return { kind: "rows", rows: first };
}

export function requireMetric(key: string): MetricDefinition {
  const definition = metricDefinition(key);
  if (!definition) throw new Error(`Unknown metric ${key}`);
  return definition;
}
