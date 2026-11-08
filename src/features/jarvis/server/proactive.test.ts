// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

vi.mock("server-only", () => ({}));

const { answersBlock, loadProactive, loadSummary, reactToProactive, toCandidate } = await import(
  "./proactive"
);
const {
  BRIEFING_INSTRUCTIONS,
  WEEK_SUMMARY_INSTRUCTIONS,
  briefingContext,
  briefingFacts,
  briefingIsEmpty,
  briefingStale,
  briefUser,
  resolveSummary,
  summaryLinks,
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
/** A company the user works for. */
const OWNER_SPACE = "00000000-0000-4000-8000-0000000000aa";
const ID = "11111111-1111-4111-8111-111111111111";
const MILESTONE = "22222222-2222-4222-8222-222222222222";
const settingsRow = {
  timezone: "Europe/Prague",
  jarvis_proactive: true,
  jarvis_frequency: "every_2h",
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
  it("says when to ask again while the 2 hours are not over, and reads nothing else", async () => {
    const supabase = fakeDb({
      workers: { data: [] },
      jarvis_suggestions: { data: [{ shown_at: "2026-10-03T09:00:00Z" }] },
    });
    const result = await loadProactive({
      supabase: supabase.db,
      admin: fakeDb().db,
      userId: USER,
      row: settingsRow,
      now: NOW,
    });
    expect(result).toEqual({ items: [], retryAt: "2026-10-03T11:00:00.000Z", settleMs: 30_000 });
    expect(supabase.calls.some((c) => c.table === "rpc:prospecting_status")).toBe(false);
  });

  it("stays silent for a worker, while the timer runs, and when switched off", async () => {
    const worker = await loadProactive({
      // In a company the account works for: the active space is the owner's.
      supabase: fakeDb({ "rpc:current_workspace_id": { data: OWNER_SPACE } }).db,
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

    // Once a day, week or month: the summary alone, nothing read in between.
    for (const frequency of ["daily", "weekly", "monthly"]) {
      const summaryOnly = fakeDb();
      const result = await loadProactive({
        supabase: summaryOnly.db,
        admin: fakeDb().db,
        userId: USER,
        row: { ...(settingsRow as object), jarvis_frequency: frequency } as never,
        now: NOW,
      });
      expect(result.items).toEqual([]);
      expect(summaryOnly.calls).toHaveLength(0);
    }
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

  it("brings everything worth saying, the most urgent first, never the brief, and asks no question", async () => {
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

const EMPTY_DAY = {
  period: "day" as const,
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
  crmTasks: { overdue: 0, dueToday: 0, top: [] },
  invoices: { overdue: 0, top: [] },
  followUps: 0,
  followUpTableId: null,
  stalled: [],
  dayPlan: "Today is a working day. Best times for calls and meetings: 08:00–12:00.",
  onFire: null,
  results: null,
  plan: null,
  facts: [],
  singleOverdueInvoiceId: null,
};

describe("morning brief", () => {
  const empty = EMPTY_DAY;
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

  it("tells about overdue sales tasks and invoices past due", () => {
    const late = {
      ...empty,
      crmTasks: {
        overdue: 2,
        dueToday: 1,
        top: [
          { title: "Zavolat", target: "Pekárna", overdue: true },
          { title: "Nabídka", target: null, overdue: false },
        ],
      },
      invoices: { overdue: 1, top: [{ number: "2026-0003", customer: "Pekárna", daysLate: 4 }] },
    };
    expect(briefingIsEmpty(late)).toBe(false);
    const context = briefingContext(late);
    expect(context).toContain('- 2 sales task(s) overdue: "Zavolat" (for "Pekárna")');
    expect(context).toContain('- 1 sales task(s) still due today: "Nabídka"');
    expect(context).toContain('- 1 invoice(s) past due: "2026-0003" to "Pekárna" 4 day(s) late');
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

describe("the week's and month's summary", () => {
  const results = {
    from: "2026-09-28",
    to: "2026-10-04",
    tasksDone: 4,
    crmTasksDone: 3,
    dealsWon: 1,
    wonTitles: ["Web pro pekárnu"],
    dealsLost: 0,
    meetings: 2,
    contactsMoved: 12,
    milestonesCompleted: [],
    invoicesPaid: 1,
  };
  const plan = {
    from: "2026-10-05",
    to: "2026-10-11",
    crmTasks: { count: 2, top: [{ id: "c1", title: "Follow-up", target: "Aura" }] },
    tasks: { count: 0, top: [] },
    events: { count: 1, top: [{ id: "e1", title: "Schůzka", day: "2026-10-07" }] },
  };
  const week = { ...EMPTY_DAY, period: "week" as const, today: "2026-10-05", results, plan };

  it("writes from last week's numbers, what is stuck and this week's plan", () => {
    expect(briefingIsEmpty(week)).toBe(false);
    const context = briefingContext(week);
    expect(context).toContain('<results period="last week, 2026-09-28 to 2026-10-04">');
    expect(context).toContain('- Deals won: 1 ("Web pro pekárnu")');
    expect(context).toContain('- 2 sales task(s) due: "Follow-up" (for "Aura")');
    expect(context).toContain('- 1 event(s): "Schůzka" on 2026-10-07');
    expect(context).toContain("This week: 2026-10-05 to 2026-10-11.");
    expect(context).not.toContain("<yesterday>");
    expect(WEEK_SUMMARY_INSTRUCTIONS).toMatch(/what went well last week/);
    expect(WEEK_SUMMARY_INSTRUCTIONS).toMatch(/Three things for this week/);
  });

  it("is empty only when the last week brought nothing and nothing waits", () => {
    const quiet = {
      ...week,
      results: { ...results, tasksDone: 0, crmTasksDone: 0, dealsWon: 0, wonTitles: [], meetings: 0, contactsMoved: 0, invoicesPaid: 0 },
      plan: { ...plan, crmTasks: { count: 0, top: [] }, events: { count: 0, top: [] } },
    };
    expect(briefingIsEmpty(quiet)).toBe(true);
  });

  it("links to this week's tasks and events instead of today's", () => {
    const links = summaryLinks({ ...week, crmTasks: { overdue: 1, dueToday: 3, top: [] } });
    expect(links.map((link) => link.key)).toEqual(["overdueCrmTasks", "periodCrmTasks", "events"]);
    expect(links[1]).toEqual({
      key: "periodCrmTasks",
      count: 2,
      href: "/app/ukoly-crm?due=thisWeek&status=open",
    });
    const month = summaryLinks({ ...week, period: "month" });
    expect(month[0]?.href).toBe(
      "/app/ukoly-crm?due=custom&status=open&from=2026-10-05&to=2026-10-11",
    );
  });
});

describe("summary links", () => {
  it("counts only what is there, most pressing first, with a link into the app", () => {
    const links = summaryLinks({
      ...EMPTY_DAY,
      crmTasks: { overdue: 2, dueToday: 1, top: [] },
      invoices: { overdue: 1, top: [] },
      singleOverdueInvoiceId: "77777777-7777-4777-8777-777777777777",
      events: [{ title: "Schůzka", time: "10:00" }],
      onFire: {
        closePast: { count: 0, top: [] },
        overdueTasks: { count: 0, top: [] },
        noTask: { count: 3, top: [] },
      },
    });
    expect(links).toEqual([
      { key: "overdueCrmTasks", count: 2, href: "/app/ukoly-crm?due=overdue&status=open" },
      { key: "noTask", count: 3, href: "/app/pipeline?tile=noTask" },
      {
        key: "overdueInvoices",
        count: 1,
        href: "/app/finance/faktury/77777777-7777-4777-8777-777777777777",
      },
      { key: "todayCrmTasks", count: 1, href: "/app/ukoly-crm?due=today" },
      { key: "events", count: 1, href: "/app/kalendar" },
    ]);
    expect(summaryLinks(EMPTY_DAY)).toEqual([]);
  });
});

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

/**
 * The admin client a summary is read with: a task due today (or nothing at
 * all), and today's stored brief as given.
 */
const data = (dueToday: boolean, stored: Record<string, unknown> | null = null) =>
  fakeDb({
    "rpc:current_plan": { data: [{ ai_calls_limit: 300, file_uploads_limit: 0, read_only: false }] },
    tasks: (call) =>
      dueToday && has(call, "select", "id, title") ? { data: [{ id: TASK, title: "Call" }] } : {},
    jarvis_suggestions: (call) =>
      has(call, "select", "id, text, payload")
        ? { data: stored }
        : op(call, "upsert")
          ? { data: { id: BRIEF } }
          : {},
  });
const upserted = (calls: Call[]) =>
  op(
    calls.find((c) => c.table === "jarvis_suggestions" && op(c, "upsert")),
    "upsert",
  )?.[0];

describe("the summary at the first arrival", () => {
  const brief = (facts: string[] | undefined, period?: string) => ({
    id: BRIEF,
    text: "Call is due today.",
    payload: { date: "2026-10-03", ...(period ? { period } : {}), ...(facts ? { facts } : {}) },
  });
  const resolve = (admin: ReturnType<typeof fakeDb>, client: ReturnType<typeof writer>["client"] | null, period: "day" | "week" = "day") =>
    resolveSummary({ client, admin: admin.db, userId: USER, row: settingsRow, period, now: NOW });

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
        crmTaskIds: ["c1"],
        invoiceIds: ["i1"],
      }),
    ).toEqual([
      `closePast:${DEAL}`,
      "crmTask:c1",
      "event:e1",
      "followUps",
      "invoice:i1",
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

  it("uses the cron's brief while everything it says still holds, without a model call", async () => {
    const { client, stream } = writer("unused");
    const admin = data(true, brief([`task:${TASK}`]));
    expect(await resolve(admin, client)).toEqual({
      status: "ready",
      id: BRIEF,
      text: "Call is due today.",
      links: [],
    });
    expect(stream).not.toHaveBeenCalled();
    expect(upserted(admin.calls)).toBeUndefined();
  });

  it("writes it again from the data now when something it says is gone, and stores it", async () => {
    const { client, stream } = writer("Call is due today, and nothing else.");
    const admin = data(true, brief([`noTask:${DEAL}`]));
    const result = await resolve(admin, client);
    expect(result).toMatchObject({ status: "ready", id: BRIEF, text: "Call is due today, and nothing else." });
    expect(stream).toHaveBeenCalledOnce();
    expect(upserted(admin.calls)).toMatchObject({
      user_id: USER,
      kind: "briefing",
      dedupe_key: "briefing:2026-10-03",
      dismissed_at: null,
      payload: { date: "2026-10-03", period: "day", facts: [`task:${TASK}`] },
    });
  });

  it("writes a week's summary when today's brief is only about the day", async () => {
    const { client, stream } = writer("Last week: one deal won.");
    const admin = data(true, brief([`task:${TASK}`], "day"));
    const result = await resolve(admin, client, "week");
    expect(result).toMatchObject({ status: "ready", text: "Last week: one deal won." });
    expect(stream).toHaveBeenCalledOnce();
    expect(upserted(admin.calls)).toMatchObject({ payload: { period: "week" } });
    // The week's summary is asked for as such (mocked model, real prompt).
    const params = (stream.mock.calls[0] as unknown[])[0] as { messages: { content: string }[] };
    expect(params.messages.at(-1)?.content).toBe("Write this week's summary.");
  });

  it("says nothing on an empty day, without a model call", async () => {
    const { client, stream } = writer("unused");
    expect(await resolve(data(false), client)).toEqual({ status: "empty" });
    expect(stream).not.toHaveBeenCalled();
  });

  it("stays silent rather than say something untrue when it cannot write", async () => {
    const admin = data(true, brief(undefined));
    expect(await resolve(admin, null)).toEqual({ status: "unavailable" });
    expect(upserted(admin.calls)).toBeUndefined();
  });
});

describe("loadSummary", () => {
  const profile = (patch: Record<string, unknown> = {}) => ({
    onboarding_completed_at: "2026-09-20T08:00:00Z",
    tour_completed_at: "2026-09-20T08:10:00Z",
    last_daily_brief_on: "2026-10-02",
    ...patch,
  });
  const supabase = (patch: Record<string, unknown> = {}, running = false) =>
    fakeDb({
      workers: { data: [] },
      unlocks: { data: [] },
      profiles: (call) =>
        has(call, "select", "mode") ? { data: { mode: "tool" } } : { data: profile(patch) },
      "rpc:prospecting_status": { data: [{ running }] },
    });
  const load = (
    client: ReturnType<typeof supabase>,
    admin: ReturnType<typeof fakeDb>,
    row: object = settingsRow as object,
    model: ReturnType<typeof writer>["client"] | null = null,
  ) =>
    loadSummary({
      supabase: client.db,
      admin: admin.db,
      userId: USER,
      row: row as never,
      client: model,
      now: NOW,
    });
  const settled = (calls: Call[]) =>
    op(
      calls.find((c) => c.table === "profiles" && op(c, "update")),
      "update",
    )?.[0];

  it("shows today's summary at the first arrival, from the data now", async () => {
    const { client } = writer("Call is due today.");
    const admin = data(true);
    const result = await load(supabase(), admin, settingsRow as object, client);
    expect(result).toEqual({
      status: "show",
      item: { id: BRIEF, period: "day", text: "Call is due today.", links: [] },
    });
    // Settled only once it is on screen (the "shown" reaction).
    expect(settled(admin.calls)).toBeUndefined();
  });

  it("says nothing once shown today, on the onboarding's day, or when switched off", async () => {
    const shown = fakeDb();
    expect(await load(supabase({ last_daily_brief_on: "2026-10-03" }), shown)).toEqual({
      status: "none",
    });
    expect(shown.calls).toHaveLength(0);
    expect(
      await load(supabase({ onboarding_completed_at: "2026-10-03T06:00:00Z" }), fakeDb()),
    ).toEqual({ status: "none" });
    const off = supabase();
    expect(
      await load(off, fakeDb(), { ...(settingsRow as object), jarvis_proactive: false }),
    ).toEqual({ status: "none" });
    expect(off.calls).toHaveLength(0);
    const worker = fakeDb({ "rpc:current_workspace_id": { data: OWNER_SPACE } });
    expect(await load(worker as ReturnType<typeof supabase>, fakeDb())).toEqual({ status: "none" });
  });

  it("waits for the next page in quiet hours, during the tour and while the timer runs", async () => {
    // 12:00 in Prague.
    const quiet = { ...(settingsRow as object), jarvis_quiet_from: 11, jarvis_quiet_to: 13 };
    expect(await load(supabase(), fakeDb(), quiet)).toEqual({ status: "wait" });
    expect(await load(supabase({ tour_completed_at: null }), fakeDb())).toEqual({ status: "wait" });
    expect(await load(supabase({}, true), fakeDb())).toEqual({ status: "wait" });
  });

  it("settles a quiet day with nothing said and no model call", async () => {
    const { client, stream } = writer("unused");
    const admin = data(false);
    expect(await load(supabase(), admin, settingsRow as object, client)).toEqual({ status: "none" });
    expect(stream).not.toHaveBeenCalled();
    expect(settled(admin.calls)).toEqual({ last_daily_brief_on: "2026-10-03" });
  });

  it("gives a weekly user the week's summary", async () => {
    const { client } = writer("Your week.");
    const weekly = { ...(settingsRow as object), jarvis_frequency: "weekly" };
    const result = await load(
      supabase({ last_daily_brief_on: "2026-09-21" }),
      data(true),
      weekly,
      client,
    );
    expect(result).toMatchObject({ status: "show", item: { period: "week", text: "Your week." } });
  });

  it("settles the day when the summary comes on screen", async () => {
    const admin = fakeDb();
    await reactToProactive({
      supabase: fakeDb({
        jarvis_suggestions: {
          data: { id: BRIEF, kind: "briefing", type: "briefing", payload: {}, dismissed_at: null, answered_at: null },
        },
      }).db,
      admin: admin.db,
      userId: USER,
      row: settingsRow,
      id: BRIEF,
      reaction: "shown",
      now: NOW,
    });
    expect(settled(admin.calls)).toEqual({ last_daily_brief_on: "2026-10-03" });
    const update = admin.calls.find((c) => c.table === "profiles");
    expect(op(update, "eq")).toEqual(["id", USER]);
  });
});

const { clearJarvisRulesCache } = await import("./rules");
const { SAFETY_RULES } = await import("../prompt");

describe("the owner's rules from the administration", () => {
  const stored = (patch: Record<string, unknown> = {}) => ({
    suggestion_types: { insight: false },
    questions: false,
    min_gap_hours: 4,
    questions_per_week: 2,
    suggestion_fresh_days: 1,
    page_settle_seconds: 90,
    instructions: "Tykej a buď stručný.",
    ...patch,
  });

  it("win over the constants: a longer gap and the page's settling", async () => {
    clearJarvisRulesCache();
    const result = await loadProactive({
      supabase: fakeDb({
        workers: { data: [] },
        jarvis_suggestions: { data: [{ shown_at: "2026-10-03T07:00:00Z" }] },
      }).db,
      admin: fakeDb({ app_settings: { data: { value: stored() } } }).db,
      userId: USER,
      row: settingsRow,
      now: NOW,
    });
    // Shown at 7:00, every 2 hours by the user's frequency, but at least 4 by the owner's rules.
    expect(result).toEqual({ items: [], retryAt: "2026-10-03T11:00:00.000Z", settleMs: 90_000 });
    clearJarvisRulesCache();
  });

  it("leave out a switched-off type, older suggestions and the questions", async () => {
    clearJarvisRulesCache();
    const rows = [
      { id: "i", kind: "suggestion", type: "insight", text: "x", action: { kind: "ask", prompt: "" }, payload: {}, created_at: "2026-10-03T09:00:00Z" },
      { id: "fresh", kind: "suggestion", type: "overdueTask", text: "x", action: { kind: "ask", prompt: "" }, payload: {}, created_at: "2026-10-03T08:00:00Z" },
      { id: "old", kind: "suggestion", type: "overdueTask", text: "x", action: { kind: "ask", prompt: "" }, payload: {}, created_at: "2026-10-01T08:00:00Z" },
    ];
    const supabase = fakeDb({
      workers: { data: [] },
      unlocks: { data: [] },
      profiles: { data: { mode: "tool" } },
      "rpc:prospecting_status": { data: [{ running: false }] },
      jarvis_suggestions: (call) =>
        has(call, "select", "shown_at") ? { data: [] } : { data: rows },
    });
    const admin = fakeDb({ app_settings: { data: { value: stored() } } });
    const result = await loadProactive({
      supabase: supabase.db,
      admin: admin.db,
      userId: USER,
      row: settingsRow,
      now: NOW,
    });
    expect(result.items.map((item) => item.id)).toEqual(["fresh"]);

    // Nothing left and the questions off: no question is written either.
    clearJarvisRulesCache();
    const empty = fakeDb({
      workers: { data: [] },
      "rpc:prospecting_status": { data: [{ running: false }] },
      jarvis_suggestions: { data: [] },
    });
    const quiet = fakeDb({ app_settings: { data: { value: stored() } } });
    const none = await loadProactive({
      supabase: empty.db,
      admin: quiet.db,
      userId: USER,
      row: settingsRow,
      now: NOW,
    });
    expect(none.items).toEqual([]);
    expect(quiet.calls.some((c) => op(c, "upsert"))).toBe(false);
    clearJarvisRulesCache();
  });

  it("put the owner's instructions into the summary after its own and before the safety rules", async () => {
    clearJarvisRulesCache();
    const { client, stream } = writer("Call is due today.");
    const admin = fakeDb({
      "rpc:current_plan": { data: [{ ai_calls_limit: 300, file_uploads_limit: 0, read_only: false }] },
      app_settings: { data: { value: stored() } },
      tasks: (call) =>
        has(call, "select", "id, title") ? { data: [{ id: TASK, title: "Call" }] } : {},
      jarvis_suggestions: (call) =>
        has(call, "select", "id, text, payload")
          ? { data: null }
          : op(call, "upsert")
            ? { data: { id: BRIEF } }
            : {},
    });
    await resolveSummary({ client, admin: admin.db, userId: USER, row: settingsRow, period: "day", now: NOW });
    const params = (stream.mock.calls[0] as unknown[])[0] as { system: { text: string }[] };
    const system = params.system[0]!.text;
    expect(system.startsWith(BRIEFING_INSTRUCTIONS)).toBe(true);
    const owner = system.indexOf("Tykej a buď stručný.");
    expect(owner).toBeGreaterThan(BRIEFING_INSTRUCTIONS.length);
    expect(system.indexOf(SAFETY_RULES)).toBeGreaterThan(owner);
    expect(system.endsWith(SAFETY_RULES)).toBe(true);
    clearJarvisRulesCache();
  });
});
