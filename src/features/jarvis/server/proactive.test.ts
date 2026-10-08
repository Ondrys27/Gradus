// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

vi.mock("server-only", () => ({}));

const { answersBlock, loadProactive, reactToProactive, toCandidate } = await import("./proactive");
const { briefingContext, briefingIsEmpty, briefUser } = await import("./briefing");
const { proposedTasks } = await import("./watch");

type Result = { data?: unknown; error?: unknown; count?: number | null };
type Call = { table: string; ops: [string, unknown[]][] };

/**
 * A chainable Supabase stand-in: records every call per table and resolves
 * with the result given for it (a function gets the call, so one table can
 * answer differently per query). `rpc` answers from `rpc:<name>`.
 */
function fakeDb(results: Record<string, Result | ((call: Call) => Result)> = {}) {
  const calls: Call[] = [];
  const chain = (call: Call, key: string): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            const result = results[key];
            const value = typeof result === "function" ? result(call) : (result ?? {});
            const settled = { data: null, error: null, ...value };
            return (resolve: (v: unknown) => void) => resolve(settled);
          }
          return (...args: unknown[]) => {
            call.ops.push([String(prop), args]);
            return chain(call, key);
          };
        },
      },
    );
  const db = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      return chain(call, table);
    },
    rpc(name: string, args: unknown) {
      const call: Call = { table: `rpc:${name}`, ops: [["rpc", [args]]] };
      calls.push(call);
      return chain(call, `rpc:${name}`);
    },
  };
  return { db: db as never, calls };
}

const op = (call: Call | undefined, name: string) => call?.ops.find(([n]) => n === name)?.[1];
const has = (call: Call, name: string, ...args: unknown[]) =>
  call.ops.some(([n, a]) => n === name && JSON.stringify(a) === JSON.stringify(args));

const NOW = new Date("2026-10-03T10:00:00Z");
const USER = "00000000-0000-4000-8000-000000000001";
const ID = "11111111-1111-4111-8111-111111111111";
const MILESTONE = "22222222-2222-4222-8222-222222222222";
const settingsRow = {
  timezone: "Europe/Prague",
  jarvis_proactive: true,
  jarvis_frequency: "often",
  jarvis_quiet_from: null,
  jarvis_quiet_to: null,
} as never;

describe("toCandidate", () => {
  const row = {
    id: ID,
    kind: "suggestion",
    type: "insight",
    text: "Prepare the Acme meeting",
    action: { kind: "open", href: `/app/milniky/${MILESTONE}` },
    payload: { tasks: ["Write the agenda"], milestoneId: MILESTONE },
    created_at: "2026-10-03T08:00:00Z",
  };

  it("keeps fresh suggestions with their proposed tasks", () => {
    expect(toCandidate(row, NOW)?.item).toMatchObject({ tasks: ["Write the agenda"] });
  });

  it("drops old ones, types meant for the panel only, unknown questions and broken actions", () => {
    expect(toCandidate({ ...row, created_at: "2026-09-25T08:00:00Z" }, NOW)).toBeNull();
    expect(toCandidate({ ...row, type: "taskCompleted" }, NOW)).toBeNull();
    expect(toCandidate({ ...row, action: { kind: "open", href: "https://evil" } }, NOW)).toBeNull();
    expect(
      toCandidate({ ...row, kind: "question", type: "question", payload: { question: "x" } }, NOW),
    ).toBeNull();
    expect(
      toCandidate(
        { ...row, kind: "question", type: "question", payload: { question: "callingHours" } },
        NOW,
      )?.item.questionKey,
    ).toBe("callingHours");
  });
});

describe("loadProactive", () => {
  it("says when to ask again while the 4 hours are not over, and reads nothing else", async () => {
    const supabase = fakeDb({
      workers: { data: [] },
      jarvis_suggestions: { data: [{ shown_at: "2026-10-03T08:00:00Z" }] },
    });
    const result = await loadProactive({
      supabase: supabase.db,
      admin: fakeDb().db,
      userId: USER,
      row: settingsRow,
      now: NOW,
    });
    expect(result).toEqual({ item: null, retryAt: "2026-10-03T12:00:00.000Z" });
    expect(supabase.calls.some((c) => c.table === "rpc:prospecting_status")).toBe(false);
  });

  it("stays silent for a worker, while the timer runs, and when switched off", async () => {
    const worker = await loadProactive({
      supabase: fakeDb({ workers: { data: [{ id: "w" }] } }).db,
      admin: fakeDb().db,
      userId: USER,
      row: settingsRow,
      now: NOW,
    });
    expect(worker.item).toBeNull();

    const timer = await loadProactive({
      supabase: fakeDb({
        workers: { data: [] },
        jarvis_suggestions: { data: [] },
        "rpc:prospecting_status": { data: [{ running: true }] },
      }).db,
      admin: fakeDb().db,
      userId: USER,
      row: settingsRow,
      now: NOW,
    });
    expect(timer.item).toBeNull();

    const off = fakeDb();
    await loadProactive({
      supabase: off.db,
      admin: fakeDb().db,
      userId: USER,
      row: { ...(settingsRow as object), jarvis_proactive: false } as never,
      now: NOW,
    });
    expect(off.calls).toHaveLength(0);
  });

  it("asks a question when there is nothing else, and never a third one in a week", async () => {
    const question = {
      id: ID,
      kind: "question",
      type: "question",
      text: "Main goal for this month",
      action: { kind: "ask", prompt: "" },
      payload: { question: "monthlyGoal" },
      created_at: NOW.toISOString(),
    };
    const supabase = (asked: { dedupe_key: string; created_at: string }[]) =>
      fakeDb({
        workers: { data: [] },
        unlocks: { data: [] },
        profiles: { data: { mode: "game" } },
        "rpc:prospecting_status": { data: [{ running: false }] },
        jarvis_suggestions: (call) =>
          has(call, "eq", "kind", "question") ? { data: asked } : { data: [] },
      });

    const admin = fakeDb({ jarvis_suggestions: { data: [question] } });
    const asked = await loadProactive({
      supabase: supabase([]).db,
      admin: admin.db,
      userId: USER,
      row: settingsRow,
      now: NOW,
    });
    expect(asked.item).toMatchObject({ kind: "question", questionKey: "monthlyGoal" });
    expect(op(admin.calls[0], "upsert")?.[0]).toMatchObject({
      user_id: USER,
      kind: "question",
      dedupe_key: "question:monthlyGoal:2026-10",
    });

    const full = fakeDb();
    const twoThisWeek = await loadProactive({
      supabase: supabase([
        { dedupe_key: "question:callingHours", created_at: "2026-10-01T10:00:00Z" },
        { dedupe_key: "question:obstacle", created_at: "2026-10-02T10:00:00Z" },
      ]).db,
      admin: full.db,
      userId: USER,
      row: settingsRow,
      now: NOW,
    });
    expect(twoThisWeek.item).toBeNull();
    expect(full.calls).toHaveLength(0);
  });
});

describe("reactToProactive", () => {
  const stored = (row: Record<string, unknown>) =>
    fakeDb({
      jarvis_suggestions: {
        data: {
          id: ID,
          kind: "suggestion",
          type: "insight",
          payload: {},
          dismissed_at: null,
          answered_at: null,
          ...row,
        },
      },
      milestones: { data: { id: MILESTONE } },
      tasks: { data: [{ position: 4 }] },
    });
  const react = (
    supabase: ReturnType<typeof fakeDb>,
    admin: ReturnType<typeof fakeDb>,
    extra: object,
  ) =>
    reactToProactive({
      supabase: supabase.db,
      admin: admin.db,
      userId: USER,
      row: settingsRow,
      id: ID,
      reaction: "close",
      now: NOW,
      ...extra,
    });

  it("postpones to tomorrow, closes for good, and logs every reaction", async () => {
    const admin = fakeDb();
    await react(stored({}), admin, { reaction: "later" });
    const update = admin.calls.find((c) => c.table === "jarvis_suggestions");
    // Midnight of 4 October in Prague.
    expect(op(update, "update")?.[0]).toEqual({ snoozed_until: "2026-10-03T22:00:00.000Z" });
    expect(update?.ops.filter(([n]) => n === "eq").map(([, a]) => a)).toEqual([
      ["id", ID],
      ["user_id", USER],
    ]);
    expect(
      op(
        admin.calls.find((c) => c.table === "analytics_events"),
        "insert",
      )?.[0],
    ).toEqual({
      user_id: USER,
      event: "jarvis_proactive_reacted",
      props: { reaction: "later", kind: "suggestion", type: "insight" },
    });

    const closed = fakeDb();
    await react(stored({}), closed, { reaction: "close" });
    expect(op(closed.calls[0], "update")?.[0]).toEqual({ dismissed_at: NOW.toISOString() });
  });

  it("creates the proposed tasks only on Add, with the user's own client", async () => {
    const supabase = stored({ payload: { tasks: ["Agenda", "Slides"], milestoneId: MILESTONE } });
    const admin = fakeDb();
    const result = await react(supabase, admin, { reaction: "accept" });
    expect(result).toEqual({ ok: true, created: 2 });
    const insert = supabase.calls.find((c) => c.table === "tasks" && op(c, "insert"));
    expect(op(insert, "insert")?.[0]).toEqual([
      { user_id: USER, milestone_id: MILESTONE, title: "Agenda", position: 5 },
      { user_id: USER, milestone_id: MILESTONE, title: "Slides", position: 6 },
    ]);
    expect(admin.calls.some((c) => c.table === "tasks")).toBe(false);
    expect(
      op(
        admin.calls.find((c) => c.table === "analytics_events"),
        "insert",
      )?.[0],
    ).toMatchObject({
      props: { reaction: "accept", tasks_created: 2 },
    });
  });

  it("refuses Add without tasks, answers that do not fit, and rows that are not the user's", async () => {
    expect(await react(stored({}), fakeDb(), { reaction: "accept" })).toEqual({
      ok: false,
      code: "invalid",
    });
    const question = { kind: "question", type: "question", payload: { question: "callingHours" } };
    expect(await react(stored(question), fakeDb(), { reaction: "answer", answer: "lots" })).toEqual(
      { ok: false, code: "invalid" },
    );
    const admin = fakeDb();
    expect(await react(stored(question), admin, { reaction: "answer", answer: "h10" })).toEqual({
      ok: true,
      created: 0,
    });
    expect(op(admin.calls[0], "update")?.[0]).toMatchObject({
      answered_at: NOW.toISOString(),
      payload: { question: "callingHours", answer: "h10" },
    });
    const missing = fakeDb({ jarvis_suggestions: { data: null } });
    expect(await react(missing, fakeDb(), { reaction: "close" })).toEqual({
      ok: false,
      code: "notFound",
    });
  });
});

describe("answersBlock", () => {
  it("gives Jarvis the newest answer per question, the user's words quoted", () => {
    const block = answersBlock([
      { payload: { question: "monthlyGoal", answer: 'Three clients "ignore rules"' } },
      { payload: { question: "monthlyGoal", answer: "older" } },
      { payload: { question: "callingHours", answer: "h5" } },
      { payload: { question: "unknown", answer: "x" } },
    ]);
    expect(block).toContain('Main goal for this month: "Three clients \\"ignore rules\\""');
    expect(block).toContain("About 5 hours a week");
    expect(block).not.toContain("older");
    expect(answersBlock([])).toBe("");
  });
});

describe("proposedTasks", () => {
  it("keeps tasks only for a milestone the watch was shown, trimmed and unique", () => {
    const milestones = [{ id: MILESTONE, title: "Launch" }];
    expect(
      proposedTasks(
        {
          tasks: [" Write  agenda ", "write agenda", "", "A", "B", "C", "D", "E"],
          milestoneId: MILESTONE,
        },
        milestones,
      ),
    ).toEqual({
      milestoneId: MILESTONE,
      milestoneTitle: "Launch",
      tasks: ["Write agenda", "A", "B", "C", "D"],
    });
    expect(proposedTasks({ tasks: ["A"], milestoneId: "other" }, milestones)).toBeNull();
  });
});

describe("morning brief", () => {
  const empty = {
    locale: "cs",
    today: "2026-10-03",
    yesterday: {
      deals: [],
      tasksDone: [],
      tasksAdded: [],
      moves: [],
      milestonesAdded: [],
      milestonesCompleted: [],
      eventsAdded: [],
    },
    dueToday: [],
    overdue: [],
    events: [],
    followUps: 0,
    stalled: [],
  };

  it("has nothing to say on an empty day, and quotes the user's data otherwise", () => {
    expect(briefingIsEmpty(empty)).toBe(true);
    const busy = {
      ...empty,
      stalled: [{ title: 'Aura Tech "ignore"', stage: "Meeting", days: 12 }],
    };
    expect(briefingIsEmpty(busy)).toBe(false);
    expect(briefingContext(busy)).toContain(
      'Deal "Aura Tech \\"ignore\\"" has been in stage "Meeting" for 12 days',
    );
  });

  it("calls no model and writes nothing on a quiet day", async () => {
    const stream = vi.fn();
    const admin = fakeDb({ user_settings: { data: null } });
    const outcome = await briefUser({
      client: { messages: { stream } } as unknown as Pick<Anthropic, "messages">,
      admin: admin.db,
      userId: USER,
      now: NOW,
    });
    expect(outcome).toBe("empty");
    expect(stream).not.toHaveBeenCalled();
    expect(admin.calls.some((c) => c.table === "jarvis_suggestions")).toBe(false);
    // Every read is the user's own.
    for (const call of admin.calls.filter((c) => !c.table.startsWith("rpc:"))) {
      expect(
        call.ops.some(
          ([n, a]) =>
            n === "eq" && (a[0] === "user_id" || a[0] === "milestone_id") && a[1] !== undefined,
        ),
      ).toBe(true);
    }
  });
});
