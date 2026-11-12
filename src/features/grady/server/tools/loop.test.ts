import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { streamWithTools, MAX_TOOL_ROUNDS } = await import("./loop");
const { toolByName } = await import("../../tools/catalog");
const { scriptedAnswer } = await import("../e2e-model");

type Answer = (params: Anthropic.MessageStreamParams, call: number) => Anthropic.Message;

/** A model that answers with the given messages, through the streaming interface the loop reads. */
function fakeClient(answer: Answer) {
  let calls = 0;
  const checks: string[] = [];
  const stream = (params: Anthropic.MessageStreamParams) => {
    const message = answer(params, calls++);
    async function* events() {
      yield {
        type: "message_start",
        message: { usage: { input_tokens: 10, output_tokens: 0 } },
      } as never;
      for (const block of message.content) {
        if (block.type === "text") {
          yield {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: block.text },
          } as never;
        }
      }
      yield {
        type: "message_delta",
        delta: { stop_reason: message.stop_reason },
        usage: { output_tokens: 5 },
      } as never;
    }
    return Object.assign(events(), { finalMessage: async () => message });
  };
  return {
    client: {
      messages: { stream } as unknown as Anthropic["messages"],
      budget: {
        check: async (feature: string) => {
          checks.push(feature);
          return "ok" as const;
        },
        creditsExhausted: async () => undefined,
      } as never,
    },
    calls: () => calls,
    checks,
  };
}

function toolUses(calls: { name: string; input: unknown }[]): Anthropic.Message {
  return {
    id: "m",
    type: "message",
    role: "assistant",
    model: "x",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
    content: calls.map((call, index) => ({
      type: "tool_use",
      id: `t${index}`,
      name: call.name,
      input: call.input,
    })),
  } as unknown as Anthropic.Message;
}

function text(value: string): Anthropic.Message {
  return {
    id: "m",
    type: "message",
    role: "assistant",
    model: "x",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
    content: [{ type: "text", text: value, citations: null }],
  } as unknown as Anthropic.Message;
}

const tools = ["search_records", "create_contact", "set_task_status", "delete_contact"].map(
  (name) => toolByName(name)!,
);
const step = { content: JSON.stringify({ status: "done" }), isError: false, card: null };

function run(answer: Answer) {
  const fake = fakeClient(answer);
  const runTool = vi.fn(async () => step);
  const runBulk = vi.fn(async () => ({
    ...step,
    content: JSON.stringify({ status: "awaiting_confirmation" }),
  }));
  const log = vi.fn(async () => undefined);
  const result = streamWithTools({
    client: fake.client,
    userId: "u",
    context: "",
    messages: [{ role: "user", content: "hi" }],
    tools,
    runTool,
    runBulk,
    log,
  });
  return { result, runTool, runBulk, log, fake };
}

describe("the chat with tools", () => {
  it("runs the tools, gives their results back and answers; every round is checked and logged", async () => {
    const { result, runTool, log, fake } = run((params, call) =>
      call === 0
        ? toolUses([{ name: "create_contact", input: { companyName: "Kava" } }])
        : text("Done."),
    );
    const outcome = await result;
    expect(outcome).toMatchObject({ ok: true, text: "Done.", rounds: 1 });
    expect(runTool).toHaveBeenCalledWith({
      name: "create_contact",
      input: { companyName: "Kava" },
    });
    expect(fake.calls()).toBe(2);
    expect(fake.checks).toEqual(["chat", "chat"]);
    expect(log).toHaveBeenCalledTimes(2);
    for (const [entry] of log.mock.calls as unknown as [{ feature: string }][])
      expect(entry.feature).toBe("chat");
  });

  it("gathers more than five changes of one message into one proposal to confirm", async () => {
    const changes = Array.from({ length: 7 }, (_, index) => ({
      name: "set_task_status",
      input: { taskId: `00000000-0000-4000-8000-00000000000${index}`, done: true },
    }));
    const { result, runTool, runBulk } = run((_params, call) =>
      call === 0
        ? toolUses([{ name: "search_records", input: { query: "x" } }, ...changes])
        : text("Waiting."),
    );
    await result;
    // The reading tool runs; the seven changes wait on one card.
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(runBulk).toHaveBeenCalledTimes(1);
    expect((runBulk.mock.calls[0] as unknown as [unknown[]])[0]).toHaveLength(7);
  });

  it("stops after the last round of tools and answers without them", async () => {
    const seen: (string | undefined)[] = [];
    const { result } = run((params, call) => {
      seen.push((params.tool_choice as { type?: string } | undefined)?.type);
      return call < MAX_TOOL_ROUNDS + 5
        ? toolUses([{ name: "search_records", input: { query: "x" } }])
        : text("x");
    });
    const outcome = await result;
    expect(outcome.rounds).toBe(MAX_TOOL_ROUNDS);
    expect(seen).toHaveLength(MAX_TOOL_ROUNDS + 1);
    expect(seen.at(-1)).toBe("none");
  });

  it("the e2e stand-in calls only the tools the account was offered", () => {
    const offered = {
      messages: [{ role: "user" as const, content: "x" }],
      tools: [{ name: "list_deals", input_schema: { type: "object" as const } }],
    };
    const missing = scriptedAnswer(offered, [{ name: "create_deal", input: {} }]);
    expect(missing.content[0]).toMatchObject({
      type: "text",
      text: "E2E tools: not offered: create_deal",
    });
    const called = scriptedAnswer(offered, [{ name: "list_deals", input: {} }]);
    expect(called.stop_reason).toBe("tool_use");
  });
});
