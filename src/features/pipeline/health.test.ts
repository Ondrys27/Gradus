import { describe, expect, it } from "vitest";
import { DEFAULT_FORMAT_SETTINGS, type FormatSettings } from "@/lib/format";
import {
  daysBetween,
  healthIsClear,
  healthLevel,
  isHealthTile,
  pipelineHealth,
  type HealthDeal,
  type HealthInput,
  type OpenDealTask,
} from "./health";

const PRAGUE: FormatSettings = { ...DEFAULT_FORMAT_SETTINGS, timeZone: "Europe/Prague" };
// Wednesday 4 November 2026, 10:00 in Prague (UTC+1).
const NOW = new Date("2026-11-04T09:00:00Z");
const OWNER = "owner";
const WORKER = "worker";

const deal = (id: string, extra: Partial<HealthDeal> = {}): HealthDeal => ({
  id,
  title: id,
  stage_id: "lead",
  expected_close_date: null,
  created_at: "2026-10-20T08:00:00Z",
  assignee_id: OWNER,
  won_at: null,
  lost_at: null,
  contact: null,
  ...extra,
});
const won = (id: string, extra: Partial<HealthDeal> = {}) =>
  deal(id, { stage_id: "won", won_at: "2026-10-30T08:00:00Z", ...extra });
const lost = (id: string, extra: Partial<HealthDeal> = {}) =>
  deal(id, { stage_id: "lost", lost_at: "2026-10-30T08:00:00Z", ...extra });

let taskId = 0;
const task = (dealId: string, dueAt: string, extra: Partial<OpenDealTask> = {}): OpenDealTask => ({
  id: `t${++taskId}`,
  deal_id: dealId,
  due_at: dueAt,
  assignee_id: OWNER,
  deal: null,
  ...extra,
});

function health(input: Partial<HealthInput>) {
  return pipelineHealth({
    deals: [],
    tasks: [],
    lastDone: new Map(),
    assigneeId: null,
    now: NOW,
    settings: PRAGUE,
    ...input,
  });
}

describe("healthLevel", () => {
  it("is green at zero, yellow up to three, red above", () => {
    expect(healthLevel(0)).toBe("ok");
    expect(healthLevel(1)).toBe("warn");
    expect(healthLevel(3)).toBe("warn");
    expect(healthLevel(4)).toBe("alert");
  });

  it("knows its tiles", () => {
    expect(isHealthTile("closePast")).toBe(true);
    expect(isHealthTile("noTask")).toBe(true);
    expect(isHealthTile("stalled")).toBe(false);
    expect(isHealthTile(null)).toBe(false);
  });
});

describe("Close Date in the past", () => {
  it("counts open deals whose Close Date is before today in the user's zone", () => {
    const result = health({
      deals: [
        deal("yesterday", { expected_close_date: "2026-11-03" }),
        deal("today", { expected_close_date: "2026-11-04" }),
        deal("tomorrow", { expected_close_date: "2026-11-05" }),
        deal("none"),
        deal("old", { expected_close_date: "2026-10-12" }),
      ],
    });
    expect(result.closePast.count).toBe(2);
    expect(result.closePast.rows.map((row) => row.deal.id)).toEqual(["old", "yesterday"]);
    expect(result.closePast.rows[0]).toMatchObject({ closeDate: "2026-10-12", days: 23 });
  });

  it("leaves out won and lost deals", () => {
    const result = health({
      deals: [
        won("won", { expected_close_date: "2026-10-01" }),
        lost("lost", { expected_close_date: "2026-10-01" }),
      ],
    });
    expect(result.closePast.count).toBe(0);
  });

  it("uses the day in the user's zone, not UTC", () => {
    // 23:30 UTC on 3 November is already 4 November in Prague.
    const lateNight = new Date("2026-11-03T23:30:00Z");
    const result = health({
      deals: [deal("d", { expected_close_date: "2026-11-03" })],
      now: lateNight,
    });
    expect(result.closePast.count).toBe(1);
    const utc = health({
      deals: [deal("d", { expected_close_date: "2026-11-03" })],
      now: lateNight,
      settings: { ...PRAGUE, timeZone: "UTC" },
    });
    expect(utc.closePast.count).toBe(0);
  });
});

describe("overdue tasks", () => {
  it("counts tasks, not deals, to the minute", () => {
    const result = health({
      deals: [deal("a"), deal("b")],
      tasks: [
        task("a", "2026-11-02T08:00:00Z"),
        task("a", "2026-11-04T08:59:00Z"),
        task("a", "2026-11-04T09:00:00Z"), // due right now: not yet overdue
        task("b", "2026-11-03T14:00:00Z"),
        task("b", "2026-11-05T09:00:00Z"),
      ],
    });
    expect(result.overdueTasks.count).toBe(3);
    expect(result.overdueTasks.rows.map((row) => row.deal.id)).toEqual(["a", "b"]);
    expect(result.overdueTasks.rows[0]).toMatchObject({
      tasks: 2,
      oldestDueAt: "2026-11-02T08:00:00Z",
      days: 2,
    });
    expect(result.overdueTasks.rows[1]).toMatchObject({ tasks: 1, days: 1 });
  });

  it("includes tasks of won and lost deals", () => {
    const result = health({
      deals: [won("won"), lost("lost")],
      tasks: [task("won", "2026-11-01T08:00:00Z"), task("lost", "2026-11-01T08:00:00Z")],
    });
    expect(result.overdueTasks.count).toBe(2);
  });

  it("takes the deal from the task when the board does not hold it", () => {
    const result = health({
      deals: [],
      tasks: [task("old", "2026-11-01T08:00:00Z", { deal: won("old", { title: "Starý" }) })],
    });
    expect(result.overdueTasks.count).toBe(1);
    expect(result.overdueTasks.rows[0]!.deal.title).toBe("Starý");
  });

  it("skips a task whose deal can not be seen at all", () => {
    const result = health({ tasks: [task("hidden", "2026-11-01T08:00:00Z")] });
    expect(result.overdueTasks).toEqual({ count: 0, rows: [] });
  });
});

describe("deals without an open task", () => {
  it("counts open deals with no open task, whoever the task is given to", () => {
    const result = health({
      deals: [deal("bare"), deal("busy"), deal("other")],
      tasks: [
        task("busy", "2026-11-10T08:00:00Z"),
        task("other", "2026-11-01T08:00:00Z", { assignee_id: WORKER }),
      ],
    });
    expect(result.noTask.count).toBe(1);
    expect(result.noTask.rows[0]!.deal.id).toBe("bare");
  });

  it("leaves out won and lost deals", () => {
    const result = health({ deals: [won("won"), lost("lost")] });
    expect(result.noTask.count).toBe(0);
  });

  it("counts the days since the last task was finished, else since the deal was made", () => {
    const result = health({
      deals: [
        deal("never", { created_at: "2026-10-26T08:00:00Z" }),
        deal("worked", { created_at: "2026-10-01T08:00:00Z" }),
      ],
      lastDone: new Map([["worked", "2026-11-02T15:00:00Z"]]),
    });
    expect(result.noTask.rows.map((row) => [row.deal.id, row.days])).toEqual([
      ["never", 9],
      ["worked", 2],
    ]);
  });
});

describe("a worker", () => {
  it("counts only the deals they look after and the tasks given to them", () => {
    const result = health({
      assigneeId: WORKER,
      deals: [
        deal("mine", { assignee_id: WORKER, expected_close_date: "2026-11-01" }),
        deal("owners", { expected_close_date: "2026-11-01" }),
      ],
      tasks: [
        task("owners", "2026-11-01T08:00:00Z", { assignee_id: WORKER }),
        task("owners", "2026-11-01T08:00:00Z"),
        task("mine", "2026-11-01T08:00:00Z"),
      ],
    });
    expect(result.closePast.rows.map((row) => row.deal.id)).toEqual(["mine"]);
    expect(result.overdueTasks.count).toBe(1);
    expect(result.overdueTasks.rows[0]!.deal.id).toBe("owners");
    // "mine" has an open task (the owner's), so it is not without one.
    expect(result.noTask.count).toBe(0);
  });
});

describe("helpers", () => {
  it("counts calendar days and never goes negative", () => {
    expect(daysBetween("2026-10-12", "2026-11-04")).toBe(23);
    expect(daysBetween("2026-11-04", "2026-11-04")).toBe(0);
    expect(daysBetween("2026-11-05", "2026-11-04")).toBe(0);
  });

  it("is clear only with zero everywhere", () => {
    expect(healthIsClear(health({}))).toBe(true);
    expect(healthIsClear(health({ deals: [deal("bare")] }))).toBe(false);
  });
});
