import { describe, expect, it } from "vitest";
import { DEFAULT_FORMAT_SETTINGS } from "@/lib/format";
import {
  bucketDeals,
  bucketKeys,
  bucketTasks,
  bucketUnit,
  dashboardStats,
  horizonRange,
  type ChartDeal,
  type Horizon,
} from "./chart-logic";
import type { WorkTask } from "./outcome";

const settings = {
  ...DEFAULT_FORMAT_SETTINGS,
  timeZone: "Europe/Prague",
  weekStartsOn: 1 as const,
  currency: "CZK",
};
const TODAY = "2026-11-04"; // a Wednesday
const NOW = new Date("2026-11-04T10:00:00.000Z");

function task(partial: Partial<WorkTask>): WorkTask {
  return {
    id: crypto.randomUUID(),
    origin: "crm",
    title: "T",
    done: false,
    dueAt: "2026-11-02T08:00:00.000Z",
    dueDay: null,
    completedAt: null,
    createdAt: "2026-10-01T08:00:00.000Z",
    ...partial,
  };
}
function deal(partial: Partial<ChartDeal>): ChartDeal {
  return {
    id: crypto.randomUUID(),
    value: 1000,
    currency: "CZK",
    kind: "open",
    createdAt: "2026-11-02T08:00:00.000Z",
    wonAt: null,
    lostAt: null,
    ...partial,
  };
}

describe("horizons", () => {
  it("ends today and picks the bucket by the horizon", () => {
    const week = horizonRange({ kind: "week" }, TODAY, settings);
    expect(week).toEqual({ from: "2026-10-29", to: TODAY });
    expect(bucketKeys(week, bucketUnit({ kind: "week" }, week), settings)).toHaveLength(7);

    const month = horizonRange({ kind: "month" }, TODAY, settings);
    expect(bucketKeys(month, "day", settings)).toHaveLength(30);

    const quarter = horizonRange({ kind: "quarter" }, TODAY, settings);
    expect(quarter.from).toBe("2026-08-10"); // a Monday, 12 weeks before this week's
    expect(bucketUnit({ kind: "quarter" }, quarter)).toBe("week");
    expect(bucketKeys(quarter, "week", settings)).toHaveLength(13);

    const year = horizonRange({ kind: "year" }, TODAY, settings);
    expect(year.from).toBe("2025-12-01");
    expect(bucketKeys(year, "month", settings)).toEqual(
      expect.arrayContaining(["2025-12-01", "2026-11-01"]),
    );
    expect(bucketKeys(year, "month", settings)).toHaveLength(12);
  });

  it("cuts a custom range by its length and orders its ends", () => {
    const short: Horizon = { kind: "custom", from: "2026-10-31", to: "2026-10-01" };
    const range = horizonRange(short, TODAY, settings);
    expect(range).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(bucketUnit(short, range)).toBe("day");
    const half: Horizon = { kind: "custom", from: "2026-03-01", to: "2026-10-31" };
    expect(bucketUnit(half, horizonRange(half, TODAY, settings))).toBe("week");
    const long: Horizon = { kind: "custom", from: "2024-01-01", to: "2026-10-31" };
    expect(bucketUnit(long, horizonRange(long, TODAY, settings))).toBe("month");
  });

  it("starts weeks on the user's first day", () => {
    const sunday = { ...settings, weekStartsOn: 0 as const };
    expect(bucketKeys({ from: "2026-11-02", to: "2026-11-04" }, "week", sunday)).toEqual([
      "2026-11-01",
    ]);
  });
});

describe("tasks in buckets", () => {
  it("counts done tasks by completion day and missed ones by due day", () => {
    const range = horizonRange({ kind: "week" }, TODAY, settings);
    const rows = bucketTasks(
      [
        task({ done: true, completedAt: "2026-11-02T07:00:00.000Z" }), // in time, Nov 2
        task({ done: true, completedAt: "2026-11-03T09:00:00.000Z" }), // late, Nov 3
        task({}), // missed, due Nov 2
        task({ dueAt: "2026-11-05T08:00:00.000Z" }), // open, not counted
        task({
          done: true,
          dueAt: "2026-10-01T08:00:00.000Z",
          completedAt: "2026-10-01T07:00:00.000Z",
        }), // outside
      ],
      range,
      "day",
      NOW,
      settings,
    );
    expect(rows.find((row) => row.key === "2026-11-02")).toEqual({
      key: "2026-11-02",
      onTime: 1,
      late: 0,
      missed: 1,
    });
    expect(rows.find((row) => row.key === "2026-11-03")?.late).toBe(1);
    expect(rows.reduce((sum, row) => sum + row.onTime + row.late + row.missed, 0)).toBe(3);
  });
});

describe("deals in buckets", () => {
  it("counts won, lost and opened and sums won value in the display currency only", () => {
    const range = horizonRange({ kind: "week" }, TODAY, settings);
    const { rows, otherCurrencyWon } = bucketDeals(
      [
        deal({ kind: "won", wonAt: "2026-11-03T09:00:00.000Z", value: 2000 }),
        deal({ kind: "won", wonAt: "2026-11-03T10:00:00.000Z", value: 500, currency: "EUR" }),
        deal({ kind: "lost", lostAt: "2026-11-04T09:00:00.000Z" }),
        deal({ createdAt: "2026-09-01T08:00:00.000Z" }),
      ],
      range,
      "day",
      settings,
    );
    const nov3 = rows.find((row) => row.key === "2026-11-03")!;
    expect(nov3).toMatchObject({ won: 2, wonValue: 2000 });
    expect(rows.find((row) => row.key === "2026-11-04")?.lost).toBe(1);
    expect(rows.find((row) => row.key === "2026-11-02")?.opened).toBe(3);
    expect(otherCurrencyWon).toBe(1);
  });
});

describe("the four numbers", () => {
  it("counts open and overdue tasks, open deals and deals won in the horizon", () => {
    const range = horizonRange({ kind: "week" }, TODAY, settings);
    const stats = dashboardStats(
      [
        task({}),
        task({ dueAt: "2026-11-09T08:00:00.000Z" }),
        task({ done: true, completedAt: NOW.toISOString() }),
      ],
      [
        deal({}),
        deal({ kind: "won", wonAt: "2026-11-01T09:00:00.000Z" }),
        deal({ kind: "won", wonAt: "2026-01-01T09:00:00.000Z" }),
      ],
      range,
      NOW,
      settings,
    );
    expect(stats).toEqual({ openTasks: 2, overdueTasks: 1, openDeals: 1, wonDeals: 1 });
  });
});
