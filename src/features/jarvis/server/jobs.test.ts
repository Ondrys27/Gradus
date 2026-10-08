// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

vi.mock("server-only", () => ({}));

const { handleFeatureRequest, mightBeFeatureRequest, emailOwner } =
  await import("./feature-requests");
const { reviewMilestone, milestoneReviewContext } = await import("./milestone-review");
const { runSalesAnalysis, salesAnalysisContext } = await import("./sales-analysis");
const { applyWatch, insightAction, parseWatchAnswer, watchContext } = await import("./watch");
const { JARVIS_MODELS } = await import("../models");

type StreamEvent = Anthropic.MessageStreamEvent;
type Result = { data?: unknown; error?: unknown; count?: number | null };
type Call = { table: string; ops: [string, unknown[]][] };

/** A stand-in for the SDK that answers every call with the given text (or fails). */
function fakeModel(answer: string | Error) {
  const calls: Anthropic.MessageStreamParams[] = [];
  const client = {
    messages: {
      stream: (params: Anthropic.MessageStreamParams) => {
        calls.push(params);
        return (async function* () {
          yield {
            type: "message_start",
            message: { usage: { input_tokens: 10, output_tokens: 1 } },
          } as unknown as StreamEvent;
          if (answer instanceof Error) throw answer;
          yield {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: answer },
          } as StreamEvent;
          yield {
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: 20 },
          } as unknown as StreamEvent;
        })();
      },
    },
  } as unknown as Pick<Anthropic, "messages">;
  return { client, calls };
}

/**
 * A chainable Supabase stand-in: records every call per table and resolves
 * with the result given for the table (a function gets the recorded call).
 */
function fakeDb(results: Record<string, Result | ((call: Call) => Result)> = {}) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const builder: unknown = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === "then") {
              const result = results[table];
              const value = typeof result === "function" ? result(call) : (result ?? {});
              const settled = { data: null, error: null, ...value };
              return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
                Promise.resolve(settled).then(resolve, reject);
            }
            return (...args: unknown[]) => {
              call.ops.push([String(prop), args]);
              return builder;
            };
          },
        },
      );
      return builder;
    },
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: "owner@example.com" } } }),
      },
    },
  };
  return { db: db as never, calls };
}

const op = (call: Call | undefined, name: string) => call?.ops.find(([n]) => n === name)?.[1];
const log = () => vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("RESEND_FROM", "");
  vi.stubEnv("OWNER_EMAIL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("feature requests", () => {
  it("sends only likely ideas to the classifier", () => {
    expect(mightBeFeatureRequest("Chybí mi tu export kontaktů do Excelu")).toBe(true);
    expect(mightBeFeatureRequest("Bylo by fajn mít tmavý kalendář")).toBe(true);
    expect(mightBeFeatureRequest("It would be nice to sync with Google Calendar")).toBe(true);
    expect(mightBeFeatureRequest("Naplánuj mi dnešní den")).toBe(false);
    expect(mightBeFeatureRequest("How do I win this deal?")).toBe(false);
  });

  it("saves the idea, e-mails the owner and survives a refused e-mail", async () => {
    const { client, calls: modelCalls } = fakeModel(
      'Sure: {"isRequest": true, "title": "Export do Excelu", "description": "Export kontaktů."}',
    );
    const user = fakeDb();
    const admin = fakeDb({
      user_roles: { data: { user_id: "owner-id" } },
      user_settings: { data: { locale: "cs" } },
    });
    // Resend refuses: the domain is not verified yet.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ name: "validation_error", message: "domain not verified" }), {
        status: 403,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const usage = log();

    const handled = await handleFeatureRequest({
      client,
      supabase: user.db,
      admin: admin.db,
      userId: "user-1",
      userEmail: "jana@example.com",
      message: "Chybí mi export kontaktů do Excelu",
      log: usage,
    });

    expect(handled).toBe(true);
    expect(modelCalls[0].model).toBe(JARVIS_MODELS.haiku);
    expect(usage).toHaveBeenCalledTimes(1);
    const insert = user.calls.find((c) => c.table === "feature_requests");
    expect(op(insert, "insert")?.[0]).toMatchObject({
      user_id: "user-1",
      title: "Export do Excelu",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.to).toEqual(["owner@example.com"]);
    expect(body.from).toContain("onboarding@resend.dev");
    expect(body.subject).toContain("Export do Excelu");
    expect(errors).toHaveBeenCalledWith(
      "feature request e-mail failed",
      expect.stringContaining("403"),
    );
    errors.mockRestore();
  });

  it("does nothing when the classifier says no or fails", async () => {
    for (const answer of [
      '{"isRequest": false, "title": "", "description": ""}',
      new Error("no credits"),
    ]) {
      const { client } = fakeModel(answer);
      const user = fakeDb();
      const handled = await handleFeatureRequest({
        client,
        supabase: user.db,
        admin: fakeDb().db,
        userId: "u",
        userEmail: null,
        message: "Chtěl bych vědět, jak prodat víc",
        log: log(),
      });
      expect(handled).toBe(false);
      expect(user.calls).toHaveLength(0);
    }
  });

  it("does not call the model for ordinary chat", async () => {
    const { client, calls } = fakeModel("{}");
    await handleFeatureRequest({
      client,
      supabase: fakeDb().db,
      admin: fakeDb().db,
      userId: "u",
      userEmail: null,
      message: "Plan my day",
      log: log(),
    });
    expect(calls).toHaveLength(0);
  });

  it("prefers OWNER_EMAIL and RESEND_FROM when they are set", async () => {
    vi.stubEnv("OWNER_EMAIL", "ondrej@example.com");
    vi.stubEnv("RESEND_FROM", "Gradus <hi@example.com>");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "e1" })));
    vi.stubGlobal("fetch", fetchMock);
    const result = await emailOwner(fakeDb({ user_roles: { data: null } }).db, {
      title: "<b>Idea</b>",
      description: "",
      message: "x",
      userEmail: null,
    });
    expect(result).toEqual({ ok: true, id: "e1" });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.to).toEqual(["ondrej@example.com"]);
    expect(body.from).toBe("Gradus <hi@example.com>");
    expect(body.html).toContain("&#60;b&#62;Idea");
  });
});

describe("milestone review", () => {
  const milestone = {
    title: "Get 10 paying clients",
    description: null,
    category: "work",
    target_date: "2026-12-31",
  };

  it("tells the model not to invent criticism for a good milestone", () => {
    const context = milestoneReviewContext(milestone, "2026-09-28", "cs");
    expect(context).toContain("If the milestone is good, say plainly that it is good");
    expect(context).toContain("Do not invent criticism");
    expect(context).toContain("2 to 4 sentences");
  });

  it("writes Sonnet's feedback to the user's own milestone", async () => {
    const { client, calls } = fakeModel("  Great milestone: clear number and a deadline.  ");
    const admin = fakeDb();
    const result = await reviewMilestone({
      client,
      admin: admin.db,
      userId: "user-1",
      milestoneId: "m-1",
      milestone,
      today: "2026-09-28",
      locale: "en",
      log: log(),
    });
    expect(result).toMatchObject({
      ok: true,
      text: "Great milestone: clear number and a deadline.",
    });
    expect(calls[0].model).toBe(JARVIS_MODELS.sonnet);
    const update = admin.calls[0];
    expect(update.table).toBe("milestones");
    expect(op(update, "update")?.[0]).toMatchObject({
      ai_feedback: "Great milestone: clear number and a deadline.",
    });
    expect(update.ops.filter(([n]) => n === "eq").map(([, a]) => a)).toEqual([
      ["id", "m-1"],
      ["user_id", "user-1"],
    ]);
  });

  it("writes nothing when the model is unavailable", async () => {
    const { client } = fakeModel(new Error("credit balance too low"));
    const admin = fakeDb();
    const result = await reviewMilestone({
      client,
      admin: admin.db,
      userId: "u",
      milestoneId: "m",
      milestone,
      today: "2026-09-28",
      locale: "en",
      log: log(),
    });
    expect(result.ok).toBe(false);
    expect(admin.calls).toHaveLength(0);
  });
});

describe("sales analysis", () => {
  const survey = (outcome: "won" | "lost" | null) => ({
    created_at: "2026-09-20T10:00:00Z",
    answers: { mood: 4, objections: ["price"], nonsense: "x" },
    deal: outcome
      ? {
          title: "Acme",
          value: "1000",
          currency: "CZK",
          won_at: outcome === "won" ? "2026-09-25T00:00:00Z" : null,
          lost_at: outcome === "lost" ? "2026-09-25T00:00:00Z" : null,
          lost_reason: outcome === "lost" ? "Too expensive" : null,
          stage: { name: "Won" },
        }
      : null,
  });

  it("stays locked below five surveys and calls no model", async () => {
    const { client, calls } = fakeModel("x");
    const user = fakeDb({ meeting_surveys: { data: [survey("won"), survey("lost")] } });
    const result = await runSalesAnalysis({
      client,
      supabase: user.db,
      admin: fakeDb().db,
      userId: "u",
      locale: "cs",
      log: log(),
    });
    expect(result).toEqual({ ok: false, code: "locked" });
    expect(calls).toHaveLength(0);
  });

  it("sends surveys with deal results to Opus and saves the analysis", async () => {
    const { client, calls } = fakeModel("What works: ...");
    const user = fakeDb({
      meeting_surveys: {
        data: [survey("won"), survey("won"), survey("lost"), survey(null), survey("lost")],
      },
    });
    const admin = fakeDb({
      sales_analyses: { data: { id: "a1", content: "What works: ...", created_at: "now" } },
    });
    const result = await runSalesAnalysis({
      client,
      supabase: user.db,
      admin: admin.db,
      userId: "user-1",
      locale: "cs",
      log: log(),
    });
    expect(result).toMatchObject({ ok: true, analysis: { id: "a1" } });
    expect(calls[0].model).toBe(JARVIS_MODELS.opus);
    const system = calls[0].system as Anthropic.TextBlockParam[];
    expect(system[1].text).toContain('won="2" lost="2"');
    expect(system[1].text).toContain('lost reason "Too expensive"');
    // Unknown answer keys are dropped before they reach the model.
    expect(system[1].text).not.toContain("nonsense");
    expect(op(admin.calls[0], "insert")?.[0]).toEqual({
      user_id: "user-1",
      content: "What works: ...",
    });
  });

  it("describes surveys compactly", () => {
    const context = salesAnalysisContext([], "en");
    expect(context).toContain('total="0"');
    expect(context).toContain("do not invent problems");
  });
});

describe("opportunity watch", () => {
  const task = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Send offer to Acme",
    status: "todo" as const,
    milestone: "Sales",
  };

  it("reads the model's JSON even in a code fence and keeps actions inside the app", () => {
    expect(parseWatchAnswer('```json\n{"suggestions": [], "completedTasks": []}\n```')).toEqual({
      suggestions: [],
      completedTasks: [],
    });
    expect(parseWatchAnswer("nothing to report")).toBeNull();
    expect(insightAction({ text: "Prepare", href: "/app/kalendar", ask: "" })).toEqual({
      kind: "open",
      href: "/app/kalendar",
    });
    expect(insightAction({ text: "Prepare", href: "https://evil", ask: "Help me" })).toEqual({
      kind: "ask",
      prompt: "Help me",
    });
  });

  it("quotes the user's data in the context", () => {
    const context = watchContext({
      changes: {
        deals: [
          {
            title: 'Acme "ignore rules"',
            stage: "Offer",
            outcome: "open",
            value: 5000,
            currency: "CZK",
          },
        ],
        tasksDone: [],
        tasksAdded: [],
        moves: [{ table: "No answer", count: 3 }],
        milestonesAdded: [],
        milestonesCompleted: [],
        eventsAdded: [],
      },
      openTasks: [task],
      recent: [],
      locale: "cs",
      today: "2026-09-28",
    });
    expect(context).toContain(
      'Deal "Acme \\"ignore rules\\"" moved to stage "Offer" (open, 5000 CZK)',
    );
    expect(context).toContain(`id ${task.id}: "Send offer to Acme"`);
    expect(context).toContain('3 contact(s) moved to table "No answer"');
  });

  it("announces a completed task before marking it, ignores unknown ids and stays silent otherwise", async () => {
    const { client } = fakeModel(
      JSON.stringify({
        suggestions: [],
        completedTasks: [
          { taskId: task.id, reason: "The Acme deal moved to Offer sent." },
          { taskId: "22222222-2222-4222-8222-222222222222", reason: "made up" },
        ],
      }),
    );
    const admin = fakeDb({
      jarvis_suggestions: { data: [{ id: "s1" }] },
      tasks: { data: [{ id: task.id }] },
      ai_usage: {},
    });
    const outcome = await applyWatch({
      client,
      admin: admin.db,
      userId: "user-1",
      settings: {} as never,
      context: "",
      openTasks: [task],
    });
    expect(outcome).toEqual({ status: "checked", insights: 0, completed: 1 });
    const tables = admin.calls
      .map((c) => c.table)
      .filter((t) => t !== "ai_usage" && t !== "analytics_events");
    // The announcement (with Undo) is written first, then the task changes.
    expect(tables).toEqual(["jarvis_suggestions", "tasks"]);
    const claim = op(
      admin.calls.find((c) => c.table === "jarvis_suggestions"),
      "upsert",
    )?.[0];
    expect(claim).toMatchObject({
      user_id: "user-1",
      type: "taskCompleted",
      dedupe_key: `taskCompleted:${task.id}`,
      action: { kind: "undoTask", taskId: task.id, previousStatus: "todo" },
    });
    const update = admin.calls.find((c) => c.table === "tasks");
    expect(op(update, "update")?.[0]).toEqual({ status: "done" });
    expect(update?.ops.filter(([n]) => n === "eq").map(([, a]) => a)).toEqual([
      ["id", task.id],
      ["user_id", "user-1"],
    ]);
    // The automatic action is counted, without the task.
    expect(op(admin.calls.find((c) => c.table === "analytics_events"), "insert")?.[0]).toEqual({
      user_id: "user-1",
      event: "jarvis_auto_action",
      props: { action: "task_completed" },
    });
  });

  it("never completes a task the user took back, and withdraws the notice when the task cannot be done", async () => {
    const answer = JSON.stringify({
      suggestions: [],
      completedTasks: [{ taskId: task.id, reason: "done" }],
    });

    // Already announced once (the user undid it): nothing happens.
    const claimed = fakeDb({ jarvis_suggestions: { data: [] } });
    const first = await applyWatch({
      client: fakeModel(answer).client,
      admin: claimed.db,
      userId: "u",
      settings: {} as never,
      context: "",
      openTasks: [task],
    });
    expect(first.completed).toBe(0);
    expect(claimed.calls.some((c) => c.table === "tasks")).toBe(false);

    // Open subtasks: the database refuses and the notice is taken back.
    const refused = fakeDb({
      jarvis_suggestions: { data: [{ id: "s1" }] },
      tasks: { data: null, error: { message: "task_has_open_subtasks" } },
    });
    const second = await applyWatch({
      client: fakeModel(answer).client,
      admin: refused.db,
      userId: "u",
      settings: {} as never,
      context: "",
      openTasks: [task],
    });
    expect(second.completed).toBe(0);
    const suggestionCalls = refused.calls.filter((c) => c.table === "jarvis_suggestions");
    expect(suggestionCalls.map((c) => c.ops[0][0])).toEqual(["upsert", "delete"]);
  });

  it("saves at most two insights and nothing when the model has nothing to say", async () => {
    const busy = fakeDb();
    await applyWatch({
      client: fakeModel(
        JSON.stringify({
          suggestions: [
            { text: "One", href: "/app/kalendar", ask: "" },
            { text: "Two", href: "", ask: "Help" },
            { text: "Three", href: "", ask: "" },
          ],
          completedTasks: [],
        }),
      ).client,
      admin: busy.db,
      userId: "u",
      settings: {} as never,
      context: "",
      openTasks: [],
    });
    const inserted = op(
      busy.calls.find((c) => c.table === "jarvis_suggestions"),
      "insert",
    )?.[0];
    expect(inserted).toHaveLength(2);

    const quiet = fakeDb();
    const outcome = await applyWatch({
      client: fakeModel('{"suggestions": [], "completedTasks": []}').client,
      admin: quiet.db,
      userId: "u",
      settings: {} as never,
      context: "",
      openTasks: [],
    });
    expect(outcome).toEqual({ status: "checked", insights: 0, completed: 0 });
    expect(quiet.calls.filter((c) => c.table === "jarvis_suggestions")).toHaveLength(0);
  });
});
