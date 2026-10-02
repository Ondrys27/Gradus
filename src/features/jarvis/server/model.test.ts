// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";

vi.mock("server-only", () => ({}));

const { errorCode, streamModel } = await import("./model");
const { JARVIS_PERSONA } = await import("../prompt");
const { JARVIS_MODELS } = await import("../models");

type StreamEvent = Anthropic.MessageStreamEvent;

/** A stand-in for the SDK: records the request and replays the given events, then maybe throws. */
function fakeClient(events: StreamEvent[], failWith?: unknown) {
  const calls: Anthropic.MessageStreamParams[] = [];
  const client = {
    messages: {
      stream: (params: Anthropic.MessageStreamParams) => {
        calls.push(params);
        return (async function* () {
          for (const event of events) yield event;
          if (failWith) throw failWith;
        })();
      },
    },
  } as unknown as Pick<Anthropic, "messages">;
  return { client, calls };
}

function start(input: number, cacheRead = 0, cacheWrite = 0): StreamEvent {
  return {
    type: "message_start",
    message: {
      usage: {
        input_tokens: input,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheWrite,
        output_tokens: 1,
      },
    },
  } as unknown as StreamEvent;
}
const delta = (text: string) =>
  ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }) as StreamEvent;
const end = (output: number) =>
  ({
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: output },
  }) as unknown as StreamEvent;

const apiError = (status: number, type: string) =>
  Anthropic.APIError.generate(
    status,
    { type: "error", error: { type, message: `${type} happened` } },
    undefined,
    new Headers(),
  );

describe("streamModel", () => {
  it("streams the text, caches the persona and logs tokens and cost once", async () => {
    const { client, calls } = fakeClient([start(300, 1200, 0), delta("Ahoj"), delta("!"), end(40)]);
    const log = vi.fn().mockResolvedValue(undefined);
    const chunks: string[] = [];

    const result = await streamModel({
      client,
      feature: "chat",
      context: "<situation>x</situation>",
      messages: [{ role: "user", content: "hi" }],
      onText: (text) => chunks.push(text),
      log,
    });

    expect(chunks).toEqual(["Ahoj", "!"]);
    expect(result).toMatchObject({ ok: true, text: "Ahoj!", model: JARVIS_MODELS.sonnet });

    const params = calls[0];
    expect(params.model).toBe(JARVIS_MODELS.sonnet);
    const system = params.system as Anthropic.TextBlockParam[];
    expect(system[0]).toEqual({
      type: "text",
      text: JARVIS_PERSONA,
      cache_control: { type: "ephemeral" },
    });
    expect(system[1]).toEqual({ type: "text", text: "<situation>x</situation>" });

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatchObject({
      feature: "chat",
      model: JARVIS_MODELS.sonnet,
      tokens: { inputTokens: 300, cacheReadTokens: 1200, cacheWriteTokens: 0, outputTokens: 40 },
    });
    expect(log.mock.calls[0][0].error).toBeUndefined();
  });

  it("sends routine work to Haiku without an effort setting", async () => {
    const { client, calls } = fakeClient([start(10), delta("yes"), end(1)]);
    await streamModel({
      client,
      feature: "classify",
      context: "",
      messages: [{ role: "user", content: "?" }],
      log: vi.fn().mockResolvedValue(undefined),
    });
    expect(calls[0].model).toBe(JARVIS_MODELS.haiku);
    expect(calls[0].output_config).toBeUndefined();
  });

  it("turns missing credits into a calm error and still logs the attempt", async () => {
    const { client } = fakeClient([], apiError(400, "invalid_request_error"));
    const log = vi.fn().mockResolvedValue(undefined);
    const result = await streamModel({
      client,
      feature: "chat",
      context: "",
      messages: [{ role: "user", content: "hi" }],
      log,
    });
    expect(result).toMatchObject({ ok: false, code: "unavailable" });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0].error).toContain("400");
  });

  it("counts the tokens of a call that breaks midway", async () => {
    const { client } = fakeClient([start(500), delta("Half")], apiError(529, "overloaded_error"));
    const log = vi.fn().mockResolvedValue(undefined);
    const result = await streamModel({
      client,
      feature: "chat",
      context: "",
      messages: [{ role: "user", content: "hi" }],
      log,
    });
    expect(result).toMatchObject({ ok: false, code: "busy", text: "Half" });
    expect(log.mock.calls[0][0].tokens.inputTokens).toBe(500);
  });

  it("treats an empty answer as a failure", async () => {
    const { client } = fakeClient([start(10), end(0)]);
    const log = vi.fn().mockResolvedValue(undefined);
    const result = await streamModel({
      client,
      feature: "chat",
      context: "",
      messages: [{ role: "user", content: "hi" }],
      log,
    });
    expect(result.ok).toBe(false);
    expect(log.mock.calls[0][0].error).toContain("empty answer");
  });
});

describe("errorCode", () => {
  it("maps API errors to what the panel says", () => {
    expect(errorCode(apiError(429, "rate_limit_error"))).toBe("busy");
    expect(errorCode(apiError(529, "overloaded_error"))).toBe("busy");
    expect(errorCode(apiError(401, "authentication_error"))).toBe("notConfigured");
    expect(errorCode(apiError(400, "invalid_request_error"))).toBe("unavailable");
    expect(errorCode(apiError(500, "api_error"))).toBe("unavailable");
    expect(errorCode(new Error("socket hang up"))).toBe("unavailable");
  });

  it("tells an account without credit apart from other bad requests", () => {
    // The exact answer the API gave on 2026-09-30 and 2026-10-02.
    const noCredit = Anthropic.APIError.generate(
      400,
      {
        type: "error",
        error: {
          type: "invalid_request_error",
          message:
            "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
        },
      },
      undefined,
      new Headers(),
    );
    expect(errorCode(noCredit)).toBe("noCredit");
    expect(errorCode(apiError(400, "billing_error"))).toBe("noCredit");
    expect(errorCode(apiError(402, "api_error"))).toBe("noCredit");
  });
});
