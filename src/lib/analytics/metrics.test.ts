import { describe, expect, it } from "vitest";
import { costBreakdown, marginByPlan } from "@/config/costs";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";
import { EVENTS, type EventName } from "./events";
import {
  METRICS,
  METRIC_CATEGORIES,
  cacheHitRate,
  daysBetween,
  daysToRefresh,
  metricDefinition,
  segmentFor,
  shiftDay,
  type EventQuery,
  type MetricDefinition,
} from "./metrics";
import { combineMetric, planMetric, requireMetric } from "./metrics-plan";

const PARAMS = { from: "2026-09-01", to: "2026-09-30" };
const RATES = { placesUsdPer1000: 35, emailUsd: 0.001, usdCzk: 20 };

function lookup(messages: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    return node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined;
  }, messages);
}

function eventQueries(definition: MetricDefinition): EventQuery[] {
  const c = definition.compute;
  switch (c.kind) {
    case "event":
    case "breakdown":
      return [c];
    case "percentiles":
      return [{ event: c.event, calc: "avg", prop: c.prop, filter: c.filter }];
    case "ratio":
      return [c.numerator, ...c.denominator];
    case "breakdown_ratio":
      return [c.numerator, c.denominator];
    default:
      return [];
  }
}

function propsOf(event: EventName): string[] {
  return Object.keys(EVENTS[event].props);
}

const COLUMNS = ["$device", "$plan", "$mode", "$locale"];

describe("metric registry", () => {
  it("has unique keys and a category for each", () => {
    const keys = METRICS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const definition of METRICS) {
      expect(METRIC_CATEGORIES).toContain(definition.category);
    }
    for (const category of METRIC_CATEGORIES) {
      expect(METRICS.some((m) => m.category === category)).toBe(true);
    }
  });

  it("names and describes every metric and category in Czech and English", () => {
    for (const definition of METRICS) {
      for (const messages of [cs, en]) {
        expect(lookup(messages, definition.nameKey), definition.nameKey).toEqual(
          expect.any(String),
        );
        expect(lookup(messages, definition.descriptionKey), definition.descriptionKey).toEqual(
          expect.any(String),
        );
      }
    }
    for (const category of METRIC_CATEGORIES) {
      expect(lookup(cs, `metrics.categories.${category}`)).toEqual(expect.any(String));
      expect(lookup(en, `metrics.categories.${category}`)).toEqual(expect.any(String));
    }
  });

  it("only uses catalog events and properties they really have", () => {
    for (const definition of METRICS) {
      const c = definition.compute;
      for (const query of eventQueries(definition)) {
        expect(EVENTS[query.event], `${definition.key}: ${query.event}`).toBeDefined();
        const props = propsOf(query.event);
        for (const prop of Object.keys(query.filter ?? {})) {
          expect(props, `${definition.key}: filter ${prop}`).toContain(prop);
        }
        if (query.prop && query.prop !== "$since_signup_days") {
          expect(props, `${definition.key}: ${query.prop}`).toContain(query.prop);
        }
      }
      if (
        c.kind === "breakdown" ||
        c.kind === "breakdown_ratio" ||
        (c.kind === "percentiles" && c.by)
      ) {
        const by = c.by!;
        const event = c.kind === "breakdown_ratio" ? c.numerator.event : c.event;
        expect([...propsOf(event), ...COLUMNS], `${definition.key}: by ${by}`).toContain(by);
      }
    }
  });

  it("does not offer segments a metric can not filter by", () => {
    expect(metricDefinition("dau")!.segments).toContain("device");
    expect(metricDefinition("signups")!.segments).not.toContain("device");
    expect(metricDefinition("errors")!.segments).toEqual([]);
    expect(metricDefinition("route_latency")!.segments).toEqual([]);
    expect(metricDefinition("funnel")!.segments).toContain("plan");
    const signups = metricDefinition("signups")!;
    expect(segmentFor(signups, { device: "mobile", plan: "pro", mode: "" })).toEqual({
      plan: "pro",
    });
  });

  it("plans every metric into calls", () => {
    for (const definition of METRICS) {
      const calls = planMetric(definition, PARAMS);
      if (definition.compute.kind === "pending") expect(calls).toEqual([]);
      else expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) expect(call.fn).toMatch(/^metric_/);
    }
  });

  it("keeps internal accounts out unless asked", () => {
    const [call] = planMetric(requireMetric("dau"), PARAMS);
    expect(call.args._include_internal).toBe(false);
    const [withInternal] = planMetric(requireMetric("dau"), { ...PARAMS, includeInternal: true });
    expect(withInternal.args._include_internal).toBe(true);
  });
});

describe("combining results", () => {
  it("divides a ratio over the whole range", () => {
    const definition = requireMetric("win_rate");
    const calls = planMetric(definition, PARAMS);
    expect(calls.map((c) => c.args._grain)).toEqual(["all", "all", "all"]);
    const result = combineMetric(definition, PARAMS, [
      [{ bucket: PARAMS.from, value: 3 }],
      [{ bucket: PARAMS.from, value: 3 }],
      [{ bucket: PARAMS.from, value: 9 }],
    ]);
    expect(result).toEqual({ kind: "value", value: 0.25 });
    expect(combineMetric(definition, PARAMS, [[], [], []])).toEqual({ kind: "value", value: null });
  });

  it("divides per group for bubble acceptance", () => {
    const result = combineMetric(requireMetric("proactive_acceptance"), PARAMS, [
      [{ key: "suggestion", value: 2 }],
      [
        { key: "suggestion", value: 8 },
        { key: "question", value: 4 },
      ],
    ]);
    expect(result).toEqual({
      kind: "breakdown",
      rows: [
        { key: "suggestion", value: 0.25 },
        { key: "question", value: 0 },
      ],
    });
  });

  it("picks D7 out of the retention rows", () => {
    const result = combineMetric(requireMetric("retention_d7"), PARAMS, [
      [
        { day_n: 1, pct: 50 },
        { day_n: 7, pct: 33.3 },
        { day_n: 30, pct: 0 },
      ],
    ]);
    expect(result).toEqual({ kind: "value", value: 33.3 });
  });

  it("keeps money per currency and only the metric's own rows", () => {
    const result = combineMetric(requireMetric("deal_value"), PARAMS, [
      [
        { metric: "deals_won", currency: "CZK", items: 2, total: 4000 },
        { metric: "deals_won", currency: "EUR", items: 1, total: 100 },
        { metric: "income", currency: "CZK", items: 1, total: 500 },
      ],
    ]);
    expect(result).toEqual({
      kind: "rows",
      rows: [
        { metric: "deals_won", currency: "CZK", items: 2, total: 4000 },
        { metric: "deals_won", currency: "EUR", items: 1, total: 100 },
      ],
    });
  });

  it("prices costs per active user across plans", () => {
    const rows = [
      { plan: "trial", active_users: 2, ai_cost_usd: 0.4, places_requests: 10, emails_sent: 1 },
      { plan: "pro", active_users: 2, ai_cost_usd: 1.6, places_requests: 0, emails_sent: 0 },
    ];
    const perUser = combineMetric(requireMetric("cost_per_active_user"), PARAMS, [rows], RATES);
    // (0.4 + 1.6 + 0.35 + 0.001) / 4
    expect(perUser.kind === "value" && perUser.value).toBeCloseTo(0.58775, 6);
    const ai = combineMetric(requireMetric("ai_cost_per_active_user"), PARAMS, [rows], RATES);
    expect(ai).toEqual({ kind: "value", value: 0.5 });
  });
});

describe("costs", () => {
  it("adds AI, Places and e-mails", () => {
    const cost = costBreakdown(
      { activeUsers: 1, aiCostUsd: 1, placesRequests: 2000, emailsSent: 100 },
      RATES,
    );
    expect(cost.placesUsd).toBe(70);
    expect(cost.emailsUsd).toBeCloseTo(0.1, 9);
    expect(cost.totalUsd).toBeCloseTo(71.1, 9);
    expect(cost.totalCzk).toBeCloseTo(1422, 6);
  });

  it("estimates the monthly margin of paid plans only", () => {
    const margins = marginByPlan(
      [
        { plan: "pro", activeUsers: 10, aiCostUsd: 20, placesRequests: 0, emailsSent: 0 },
        { plan: "beta", activeUsers: 5, aiCostUsd: 5, placesRequests: 0, emailsSent: 0 },
      ],
      15,
      RATES,
    );
    // Pro: 2 USD per user in 15 days → 4 USD a month → 80 CZK against 890 CZK.
    expect(margins[0]).toMatchObject({ plan: "pro", priceCzk: 890 });
    expect(margins[0].costPerActiveUserCzk).toBeCloseTo(80, 9);
    expect(margins[0].marginCzk).toBeCloseTo(810, 9);
    expect(margins[0].marginShare).toBeCloseTo(810 / 890, 9);
    expect(margins[1]).toMatchObject({ plan: "beta", priceCzk: null, marginCzk: null });
  });

  it("measures the cache hit rate", () => {
    expect(cacheHitRate({ input_tokens: 100, cache_read_tokens: 300, cache_write_tokens: 0 })).toBe(
      0.75,
    );
    expect(
      cacheHitRate({ input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 }),
    ).toBeNull();
  });
});

describe("days", () => {
  it("moves dates and lists ranges across months", () => {
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });

  it("refreshes the two finished days before today in Prague", () => {
    // 23:30 UTC on 31 Oct is already 1 Nov in Prague.
    expect(daysToRefresh(new Date("2026-10-31T23:30:00Z"))).toEqual(["2026-10-30", "2026-10-31"]);
  });
});
