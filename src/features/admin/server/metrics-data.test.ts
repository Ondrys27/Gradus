import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MetricParams, MetricResult } from "@/lib/analytics/metrics-plan";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

type Fake = (key: string, params: MetricParams) => Promise<MetricResult>;
let fake: Fake = async () => ({ kind: "value", value: null });
const calls: [string, MetricParams][] = [];
vi.mock("@/lib/analytics/metrics-query", () => ({
  runMetric: (_admin: unknown, key: string, params: MetricParams) => {
    calls.push([key, params]);
    return fake(key, params);
  },
}));

const { breakdown, scalarTile, seriesTile, usersTile } = await import("./metrics-data");
const { DEFAULT_VIEW } = await import("../view-state");

const q = {
  view: { ...DEFAULT_VIEW, internal: true, segment: { plan: "pro", device: "mobile" } },
  range: { from: "2026-10-06", to: "2026-10-08" },
  previous: { from: "2026-10-03", to: "2026-10-05" },
  today: "2026-10-08",
};

beforeEach(() => {
  calls.length = 0;
});

describe("admin metric blocks", () => {
  it("aggregates a daily metric for the period and the one before", async () => {
    fake = async (_key, params) => ({
      kind: "series",
      points:
        params.from === "2026-10-06"
          ? [
              { day: "2026-10-06", value: 2 },
              { day: "2026-10-07", value: 4 },
              { day: "2026-10-08", value: 6 },
            ]
          : [{ day: "2026-10-03", value: 3 }],
    });
    const tile = await seriesTile(q, "signups", "sum");
    expect(tile).toMatchObject({ key: "signups", unit: "users", value: 12, previous: 3 });
    expect(tile.spark).toEqual([2, 4, 6]);
    // Internal accounts and the segment reach the registry.
    expect(calls[0][1]).toMatchObject({
      includeInternal: true,
      segment: { plan: "pro", device: "mobile" },
    });
  });

  it("does not ask for the previous period when the comparison is off", async () => {
    fake = async () => ({ kind: "series", points: [] });
    const tile = await seriesTile({ ...q, previous: null }, "dau", "mean");
    expect(tile.previous).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("counts distinct users over the whole range, not per day", async () => {
    fake = async (_key, params) =>
      params.grain === "all"
        ? {
            kind: "series",
            points: [{ day: params.from, value: params.from === "2026-10-06" ? 5 : 2 }],
          }
        : { kind: "series", points: [{ day: "2026-10-07", value: 4 }] };
    const tile = await usersTile(q, "onboarding_completed");
    expect(tile).toMatchObject({ value: 5, previous: 2, spark: [0, 4, 0] });
  });

  it("shows a pending metric without asking the database", async () => {
    const tile = await scalarTile(q, "streak_freezes");
    expect(tile).toMatchObject({
      key: "streak_freezes",
      value: null,
      pending: "game-streak-freeze-log",
    });
    expect(calls).toHaveLength(0);
  });

  it("recomputes a share for parts of the range for its small chart", async () => {
    fake = async () => ({ kind: "value", value: 40 });
    const tile = await scalarTile(q, "activation_rate", { spark: true });
    expect(tile).toMatchObject({ value: 40, previous: 40, spark: [40, 40, 40] });
    expect(calls).toHaveLength(5);
  });

  it("pairs breakdown groups with the previous period", async () => {
    fake = async (_key, params) => ({
      kind: "breakdown",
      rows:
        params.from === "2026-10-06"
          ? [
              { key: "completed", value: 8 },
              { key: "skipped", value: 2 },
            ]
          : [{ key: "completed", value: 4 }],
    });
    const data = await breakdown(q, "tour_outcome");
    expect(data.items).toEqual([
      { key: "completed", value: 8, previous: 4 },
      { key: "skipped", value: 2, previous: null },
    ]);
  });
});
