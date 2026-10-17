// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";

vi.mock("server-only", () => ({}));

const { creditErrorCode, errorCode, streamModel } = await import("./model");
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
      userId: "user-1",
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

  it("sends routine work to Haiku without thinking, at low effort", async () => {
    const { client, calls } = fakeClient([start(10), delta("yes"), end(1)]);
    await streamModel({
      client,
      userId: "user-1",
      feature: "classify",
      context: "",
      messages: [{ role: "user", content: "?" }],
      log: vi.fn().mockResolvedValue(undefined),
    });
    expect(calls[0].model).toBe(JARVIS_MODELS.haiku);
    expect(calls[0].thinking).toEqual({ type: "disabled" });
    expect(calls[0].output_config).toEqual({ effort: "low" });
  });

  it("turns a bad request into a calm error and still logs the attempt", async () => {
    const { client } = fakeClient([], apiError(400, "invalid_request_error"));
    const log = vi.fn().mockResolvedValue(undefined);
    const result = await streamModel({
      client,
      userId: "user-1",
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
      userId: "user-1",
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
      userId: "user-1",
      feature: "chat",
      context: "",
      messages: [{ role: "user", content: "hi" }],
      log,
    });
    expect(result.ok).toBe(false);
    expect(log.mock.calls[0][0].error).toContain("empty answer");
  });
});

describe("budget", () => {
  function guard(verdict: "ok" | "paused" | "userLimit") {
    return { check: vi.fn().mockResolvedValue(verdict), creditsExhausted: vi.fn() };
  }

  it("makes no call over the budget and answers with the pause", async () => {
    const { client, calls } = fakeClient([start(10), delta("never"), end(1)]);
    const budget = guard("paused");
    const log = vi.fn().mockResolvedValue(undefined);
    const result = await streamModel({
      client: { ...client, budget },
      userId: "user-1",
      feature: "chat",
      context: "",
      messages: [{ role: "user", content: "hi" }],
      log,
    });
    expect(result).toMatchObject({ ok: false, code: "paused", text: "" });
    expect(budget.check).toHaveBeenCalledWith("chat", "user-1");
    expect(calls).toHaveLength(0);
    expect(log).not.toHaveBeenCalled();
  });

  it("makes no call when the user's own cap is used up and says so", async () => {
    const { client, calls } = fakeClient([start(10), delta("never"), end(1)]);
    const budget = guard("userLimit");
    const log = vi.fn().mockResolvedValue(undefined);
    const result = await streamModel({
      client: { ...client, budget },
      userId: "user-1",
      feature: "milestone_review",
      context: "",
      messages: [{ role: "user", content: "hi" }],
      log,
    });
    expect(result).toMatchObject({ ok: false, code: "userLimit", text: "" });
    expect(budget.check).toHaveBeenCalledWith("milestone_review", "user-1");
    expect(calls).toHaveLength(0);
    expect(log).not.toHaveBeenCalled();
  });

  it("calls the model while the budget allows it", async () => {
    const { client, calls } = fakeClient([start(10), delta("ok"), end(1)]);
    const result = await streamModel({
      client: { ...client, budget: guard("ok") },
      userId: "user-1",
      feature: "chat",
      context: "",
      messages: [{ role: "user", content: "hi" }],
      log: vi.fn().mockResolvedValue(undefined),
    });
    expect(result).toMatchObject({ ok: true, text: "ok" });
    expect(calls).toHaveLength(1);
  });

  it("shows exhausted credit as the pause, tells the guard and logs the attempt", async () => {
    const { client } = fakeClient([], apiError(402, "billing_error"));
    const budget = guard("ok");
    const log = vi.fn().mockResolvedValue(undefined);
    const result = await streamModel({
      client: { ...client, budget },
      userId: "user-1",
      feature: "opportunity_scan",
      context: "",
      messages: [{ role: "user", content: "hi" }],
      log,
    });
    expect(result).toMatchObject({ ok: false, code: "paused" });
    expect(budget.creditsExhausted).toHaveBeenCalledWith("opportunity_scan", "billing_error");
    expect(log.mock.calls[0][0].error).toContain("billing_error");
  });

  it("does not report other failures as missing credit", async () => {
    const { client } = fakeClient([], apiError(429, "rate_limit_error"));
    const budget = guard("ok");
    const result = await streamModel({
      client: { ...client, budget },
      userId: "user-1",
      feature: "chat",
      context: "",
      messages: [{ role: "user", content: "hi" }],
      log: vi.fn().mockResolvedValue(undefined),
    });
    expect(result).toMatchObject({ ok: false, code: "busy" });
    expect(budget.creditsExhausted).not.toHaveBeenCalled();
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

  it("tells missing credit and spend limits apart by type and code, never by text", () => {
    expect(errorCode(apiError(402, "billing_error"))).toBe("paused");
    expect(errorCode(apiError(400, "billing_error"))).toBe("paused");
    expect(creditErrorCode(apiError(402, "api_error"))).toBe("billing_error");

    // The usage tier's monthly cap: a 429 with a machine-readable code, unlike a rate limit.
    const spendCap = Anthropic.APIError.generate(
      429,
      {
        type: "error",
        error: {
          type: "rate_limit_error",
          message: "You have reached your API usage limits.",
          details: { error_code: "enforced_spend_limit_reached" },
        },
      },
      undefined,
      new Headers(),
    );
    expect(creditErrorCode(spendCap)).toBe("enforced_spend_limit_reached");
    expect(errorCode(spendCap)).toBe("paused");
    expect(creditErrorCode(apiError(429, "rate_limit_error"))).toBeNull();
    expect(creditErrorCode(new Error("credit balance"))).toBeNull();

    // The answer the API gave on 2026-09-30: an ordinary invalid_request_error
    // whose only sign is the text. Not read from the text, so it stays calm
    // but generic.
    const textOnly = Anthropic.APIError.generate(
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
    expect(creditErrorCode(textOnly)).toBeNull();
    expect(errorCode(textOnly)).toBe("unavailable");
  });
});
