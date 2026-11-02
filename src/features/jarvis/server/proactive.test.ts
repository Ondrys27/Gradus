// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

vi.mock("server-only", () => ({}));

const { answersBlock, loadProactive, reactToProactive, toCandidate } = await import("./proactive");
const {
  BRIEFING_INSTRUCTIONS,
  briefingContext,
  briefingFacts,
  briefingIsEmpty,
  briefingStale,
  briefUser,
  freshenBriefing,
} = await import("./briefing");
const { proposedTasks } = await import("./watch");
const { suggestionNotBefore } = await import("./suggestions");
const { timeWindow } = await import("../time-window");

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

describe("calls and meetings outside the time window", () => {
  const zone = "Europe/Prague";
  // Tuesday 20 October 2026: 10:00 and 20:00 in Prague.
  const morning = timeWindow({
    now: new Date("2026-10-20T08:00:00Z"),
    timeZone: zone,
    country: "CZ",
  });
  const evening = timeWindow({
    now: new Date("2026-10-20T18:00:00Z"),
    timeZone: zone,
    country: "CZ",
  });
  const call = {
    id: ID,
    kind: "suggestion",
    type: "insight",
    text: "Call Acme about the offer",
    action: { kind: "ask", prompt: "Help me call Acme" },
    payload: { people: true },
    created_at: "2026-10-20T08:00:00Z",
  };
  const later = new Date("2026-10-20T18:00:00Z");

  it("brings up a call only inside the window", () => {
    expect(toCandidate(call, later, morning)).not.toBeNull();
    expect(toCandidate(call, later, evening)).toBeNull();
    // Follow-ups are always about calling back.
    const followUps = { ...call, type: "followUps", payload: {} };
    expect(toCandidate(followUps, later, evening)).toBeNull();
    // Preparation stays welcome in the evening.
    const prep = { ...call, text: "Write the agenda", payload: { people: false } };
    expect(toCandidate(prep, later, evening)).not.toBeNull();
  });

  it("filters suggestions written before the flag existed by their words", () => {
    const old = { ...call, payload: {} };
    expect(toCandidate(old, later, evening)).toBeNull();
    expect(toCandidate({ ...old, text: "Zavolej Novákovi" }, later, evening)).toBeNull();
    expect(toCandidate({ ...old, text: "Write the price list" }, later, evening)).not.toBeNull();
  });

  it("offers a call in the panel for the next window instead of now", () => {
    expect(suggestionNotBefore(call, morning)).toBeNull();
    expect(suggestionNotBefore(call, evening)).toBe("2026-10-21T06:00:00.000Z");
    expect(suggestionNotBefore({ ...call, type: "overdueTask", payload: {} }, evening)).toBeNull();
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
    expect(result).toEqual({ items: [], retryAt: "2026-10-03T12:00:00.000Z" });
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
    expect(worker.items).toEqual([]);

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
    expect(timer.items).toEqual([]);

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
    expect(asked.items).toHaveLength(1);
    expect(asked.items[0]).toMatchObject({ kind: "question", questionKey: "monthlyGoal" });
    const upsert = admin.calls.find((c) => op(c, "upsert"));
    expect(op(upsert, "upsert")?.[0]).toMatchObject({
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
    expect(twoThisWeek.items).toEqual([]);
    expect(full.calls.some((c) => op(c, "upsert"))).toBe(false);
  });
});

describe("loadProactive queue", () => {
  const suggestion = (id: string, type: string, created: string, kind = "suggestion") => ({
    id,
    kind,
    type,
    text: `About ${id}`,
    action: { kind: "ask", prompt: "" },
    payload: kind === "briefing" ? { date: "2026-10-03", facts: [] } : { people: false },
    created_at: created,
  });

  it("brings everything worth saying, briefing first, then the most urgent, and asks no question", async () => {
    const rows = [
      suggestion("insight-new", "insight", "2026-10-03T09:00:00Z"),
      suggestion("overdue", "overdueTask", "2026-10-02T09:00:00Z"),
      suggestion("insight-old", "insight", "2026-10-02T08:00:00Z"),
      suggestion("brief", "briefing", "2026-10-03T04:00:00Z", "briefing"),
      suggestion("ready", "milestoneReady", "2026-10-01T09:00:00Z"),
    ];
    const supabase = fakeDb({
      workers: { data: [] },
      unlocks: { data: [] },
      profiles: { data: { mode: "tool" } },
      "rpc:prospecting_status": { data: [{ running: false }] },
      jarvis_suggestions: (call) =>
        has(call, "select", "shown_at") ? { data: [] } : { data: rows },
    });
    const admin = fakeDb();
    const result = await loadProactive({
      supabase: supabase.db,
      admin: admin.db,
      userId: USER,
      row: settingsRow,
      now: NOW,
    });
    expect(result.items.map((item) => item.id)).toEqual([
      "brief",
      "overdue",
      "ready",
      "insight-new",
      "insight-old",
    ]);
    expect(result.retryAt).toBeNull();
    // Nothing asked, nothing rewritten; only the rules worked out again.
    expect(admin.calls.some((c) => op(c, "upsert"))).toBe(false);
  });

  it("carries at most ten notices", async () => {
    const rows = Array.from({ length: 14 }, (_, n) =>
      suggestion(`i${n}`, "insight", new Date(NOW.getTime() - (n + 1) * 60_000).toISOString()),
    );
    const result = await loadProactive({
      supabase: fakeDb({
        workers: { data: [] },
        unlocks: { data: [] },
        profiles: { data: { mode: "tool" } },
        "rpc:prospecting_status": { data: [{ running: false }] },
        jarvis_suggestions: (call) =>
          has(call, "select", "shown_at") ? { data: [] } : { data: rows },
      }).db,
      admin: fakeDb().db,
      userId: USER,
      row: settingsRow,
      now: NOW,
    });
    expect(result.items).toHaveLength(10);
    expect(result.items[0]?.id).toBe("i0");
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
    dayPlan: "Today is a working day. Best times for calls and meetings: 08:00–12:00.",
    onFire: null,
    facts: [],
  };
  const clear = {
    closePast: { count: 0, top: [] },
    overdueTasks: { count: 0, top: [] },
    noTask: { count: 0, top: [] },
  };

  it("starts with what is on fire in the pipeline, and an all-clear pipeline alone says nothing", () => {
    expect(briefingIsEmpty({ ...empty, onFire: clear })).toBe(true);
    const burning = {
      ...empty,
      onFire: {
        ...clear,
        closePast: {
          count: 1,
          top: [{ id: "d1", title: "Web pro pekárnu", closeDate: "2026-10-02", days: 1 }],
        },
      },
    };
    expect(briefingIsEmpty(burning)).toBe(false);
    const context = briefingContext(burning);
    expect(context).toContain(
      '<on_fire>Pipeline health (goal is zero everywhere): 1 open deal(s) past their Close Date ("Web pro pekárnu" Close Date 2026-10-02).</on_fire>',
    );
    expect(context.indexOf("<on_fire>")).toBeLessThan(context.indexOf("<yesterday>"));
    expect(BRIEFING_INSTRUCTIONS).toMatch(/1\. Start with what is on fire/);
  });

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
    expect(briefingContext(busy)).toContain(
      "<day_plan>Today is a working day. Best times for calls and meetings: 08:00–12:00.</day_plan>",
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
    // Every read is the user's own (sales tasks: the ones given to the user).
    const OWN = ["user_id", "milestone_id", "assignee_id"];
    for (const call of admin.calls.filter((c) => !c.table.startsWith("rpc:"))) {
      expect(
        call.ops.some(([n, a]) => n === "eq" && OWN.includes(a[0] as string) && a[1] !== undefined),
      ).toBe(true);
    }
  });
});

describe("the brief right before it shows", () => {
  const BRIEF = "33333333-3333-4333-8333-333333333333";
  const DEAL = "44444444-4444-4444-8444-444444444444";
  const TASK = "55555555-5555-4555-8555-555555555555";

  /** A model that writes one line, as the SDK streams it. */
  function writer(text: string) {
    const stream = vi.fn(() =>
      (async function* () {
        yield {
          type: "message_start",
          message: { usage: { input_tokens: 10, output_tokens: 1 } },
        };
        yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } };
        yield {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 5 },
        };
      })(),
    );
    return { client: { messages: { stream } } as unknown as Pick<Anthropic, "messages">, stream };
  }

  /** The admin client the brief is read with: a task due today, or nothing at all. */
  const data = (dueToday: boolean) =>
    fakeDb({
      "rpc:current_plan": { data: [{ ai_calls_limit: 300, file_uploads_limit: 0, read_only: false }] },
      tasks: (call) =>
        dueToday && has(call, "select", "id, title") ? { data: [{ id: TASK, title: "Call" }] } : {},
    });
  const update = (calls: Call[]) =>
    op(
      calls.find((c) => c.table === "jarvis_suggestions" && op(c, "update")),
      "update",
    )?.[0];

  it("keeps one key per thing the brief can state, sorted and once", () => {
    const deal = { id: DEAL, title: "Web", days: 3 };
    expect(
      briefingFacts({
        onFire: {
          closePast: { count: 1, top: [{ ...deal, closeDate: "2026-10-01" }] },
          overdueTasks: { count: 0, top: [] },
          noTask: { count: 1, top: [deal] },
        },
        taskIds: [TASK, TASK],
        eventIds: ["e1"],
        stalledDealIds: [DEAL],
        followUps: 2,
      }),
    ).toEqual([
      `closePast:${DEAL}`,
      "event:e1",
      "followUps",
      `noTask:${DEAL}`,
      `stalled:${DEAL}`,
      `task:${TASK}`,
    ]);
  });

  it("is untrue once one of its facts is gone, not when a new one comes", () => {
    expect(briefingStale([`noTask:${DEAL}`], [])).toBe(true);
    expect(briefingStale([`noTask:${DEAL}`], [`noTask:${DEAL}`, `task:${TASK}`])).toBe(false);
    expect(briefingStale([], [`task:${TASK}`])).toBe(false);
    // Written before facts were kept: cannot be trusted.
    expect(briefingStale(undefined, [])).toBe(true);
  });

  it("shows a brief built on no facts as it is, without reading anything", async () => {
    const admin = fakeDb();
    const text = await freshenBriefing({
      client: null,
      admin: admin.db,
      userId: USER,
      row: settingsRow,
      id: BRIEF,
      text: "Yesterday you won a deal.",
      facts: [],
      now: NOW,
    });
    expect(text).toBe("Yesterday you won a deal.");
    expect(admin.calls).toHaveLength(0);
  });

  it("shows it unchanged while everything it says still holds", async () => {
    const { client, stream } = writer("unused");
    const text = await freshenBriefing({
      client,
      admin: data(true).db,
      userId: USER,
      row: settingsRow,
      id: BRIEF,
      text: "Call is due today.",
      facts: [`task:${TASK}`],
      now: NOW,
    });
    expect(text).toBe("Call is due today.");
    expect(stream).not.toHaveBeenCalled();
  });

  it("retires it when nothing is left to say, without a model call", async () => {
    const { client, stream } = writer("unused");
    const admin = data(false);
    const text = await freshenBriefing({
      client,
      admin: admin.db,
      userId: USER,
      row: settingsRow,
      id: BRIEF,
      text: "Web has no task.",
      facts: [`noTask:${DEAL}`],
      now: NOW,
    });
    expect(text).toBeNull();
    expect(stream).not.toHaveBeenCalled();
    expect(update(admin.calls)).toEqual({ dismissed_at: NOW.toISOString() });
  });

  it("writes it again from the data now when something it says is gone, and stores it", async () => {
    const { client, stream } = writer("Call is due today.");
    const admin = data(true);
    const text = await freshenBriefing({
      client,
      admin: admin.db,
      userId: USER,
      row: settingsRow,
      id: BRIEF,
      text: "Web has no task.",
      facts: [`noTask:${DEAL}`],
      now: NOW,
    });
    expect(text).toBe("Call is due today.");
    expect(stream).toHaveBeenCalledOnce();
    expect(update(admin.calls)).toEqual({
      text: "Call is due today.",
      payload: { date: "2026-10-03", facts: [`task:${TASK}`] },
    });
  });

  it("stays silent rather than say something untrue when it cannot write", async () => {
    const admin = data(true);
    const text = await freshenBriefing({
      client: null,
      admin: admin.db,
      userId: USER,
      row: settingsRow,
      id: BRIEF,
      text: "Web has no task.",
      facts: undefined,
      now: NOW,
    });
    expect(text).toBeNull();
    expect(update(admin.calls)).toBeUndefined();
  });

  it("works the rules out again and leaves an untrue brief unsaid in the bubble", async () => {
    const rows = [
      {
        id: BRIEF,
        kind: "briefing",
        type: "briefing",
        text: "Web has no task.",
        action: { kind: "open", href: "/app" },
        payload: { date: "2026-10-03", facts: [`noTask:${DEAL}`] },
        created_at: "2026-10-03T04:00:00Z",
      },
    ];
    const admin = fakeDb();
    const result = await loadProactive({
      supabase: fakeDb({
        workers: { data: [] },
        unlocks: { data: [] },
        profiles: { data: { mode: "tool" } },
        "rpc:prospecting_status": { data: [{ running: false }] },
        jarvis_suggestions: (call) =>
          has(call, "select", "shown_at") || has(call, "eq", "kind", "question")
            ? { data: [] }
            : { data: rows },
      }).db,
      admin: admin.db,
      userId: USER,
      row: settingsRow,
      client: null,
      now: NOW,
    });
    expect(result.items.some((item) => item.id === BRIEF)).toBe(false);
    // The solved rule suggestions are retired before anything is picked.
    const retired = admin.calls.find(
      (c) => c.table === "jarvis_suggestions" && op(c, "update") && op(c, "in"),
    );
    expect(op(retired, "update")?.[0]).toHaveProperty("dismissed_at");
    expect(op(retired, "in")?.[0]).toBe("type");
  });
});
