// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

vi.mock("server-only", () => ({}));

const { suggestEmailReply, emailReplyContext, EMAIL_REPLY_INSTRUCTIONS } =
  await import("./email-reply");
const { JARVIS_MODELS } = await import("../models");

type StreamEvent = Anthropic.MessageStreamEvent;

/** A stand-in for the SDK that streams the given text, or fails like a key without credits. */
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

describe("emailReplyContext", () => {
  it("names the deal's stage and value when one is linked", () => {
    const context = emailReplyContext({
      contact: { name: "Acme s.r.o." },
      deal: { title: "Website", value: 40000, currency: "CZK", stageName: "Nabídka odeslána" },
      locale: "cs",
      receivedEmail: "Dobrý den, kolik by to stálo?",
    });
    expect(context).toContain("Acme s.r.o.");
    expect(context).toContain('"Website" (stage: Nabídka odeslána)');
    expect(context).toContain("Value: 40000 CZK");
    expect(context).toContain("Dobrý den, kolik by to stálo?");
  });

  it("says plainly that no deal is linked yet", () => {
    const context = emailReplyContext({
      contact: { name: "Jana Nováková" },
      deal: null,
      locale: "en",
      receivedEmail: "Hi, are you still available?",
    });
    expect(context).toContain("No deal is linked to this contact yet.");
  });
});

describe("suggestEmailReply", () => {
  it("returns Sonnet's draft with the cached persona and logs the call once", async () => {
    const { client, calls } = fakeModel("Dobrý den, děkuji za zprávu, ozvu se zítra.");
    const log = vi.fn(async () => {});
    const result = await suggestEmailReply({
      client,
      contact: { name: "Acme s.r.o." },
      deal: null,
      locale: "cs",
      receivedEmail: "Dobrý den, máte volno příští týden?",
      log,
    });

    expect(result).toEqual({ ok: true, reply: "Dobrý den, děkuji za zprávu, ozvu se zítra." });
    expect(calls[0].model).toBe(JARVIS_MODELS.sonnet);
    const system = calls[0].system as { text: string; cache_control?: unknown }[];
    expect(system[0].text).toBe(EMAIL_REPLY_INSTRUCTIONS);
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ feature: "email_reply" }));
  });

  it("reports a failed call clearly (e.g. a key without credits) and still logs it", async () => {
    const { client } = fakeModel(new Error("credit balance is too low"));
    const log = vi.fn(async () => {});
    const result = await suggestEmailReply({
      client,
      contact: { name: "Acme s.r.o." },
      deal: null,
      locale: "en",
      receivedEmail: "Hello, following up on our call.",
      log,
    });
    expect(result).toEqual({ ok: false, code: "unavailable" });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "email_reply", error: "credit balance is too low" }),
    );
  });

  it("refuses an empty answer", async () => {
    const { client } = fakeModel("   ");
    const result = await suggestEmailReply({
      client,
      contact: { name: "Acme s.r.o." },
      deal: null,
      locale: "en",
      receivedEmail: "Hello.",
      log: async () => {},
    });
    expect(result).toEqual({ ok: false, code: "unavailable" });
  });
});
