// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readChatStream } from "./chat-stream";
import type { ChatEvent } from "./protocol";

function ndjson(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson" } });
}

describe("readChatStream", () => {
  it("reports every line, also when lines are split across chunks", async () => {
    const events: ChatEvent[] = [];
    const last = await readChatStream(
      ndjson([
        '{"type":"start","conversationId":"c","userMessageId":"u"}\n{"type":"del',
        'ta","text":"Ahoj"}\n{"type":"delta","text":" světe"}\n',
        '{"type":"done","messageId":"m","usage":{"used":1,"limit":10}}\n',
      ]),
      (event) => events.push(event),
    );
    expect(events.map((e) => e.type)).toEqual(["start", "delta", "delta", "done"]);
    expect(events.flatMap((e) => (e.type === "delta" ? [e.text] : [])).join("")).toBe("Ahoj světe");
    expect(last).toEqual({ type: "done", messageId: "m", usage: { used: 1, limit: 10 } });
  });

  it("reads a refusal sent as plain JSON", async () => {
    const events: ChatEvent[] = [];
    const last = await readChatStream(
      Response.json(
        { type: "error", code: "limitReached", usage: { used: 10, limit: 10 } },
        { status: 429 },
      ),
      (event) => events.push(event),
    );
    expect(last).toEqual({ type: "error", code: "limitReached", usage: { used: 10, limit: 10 } });
    expect(events).toHaveLength(1);
  });

  it("turns a stream cut off mid-answer into a network error", async () => {
    const last = await readChatStream(
      ndjson([
        '{"type":"start","conversationId":"c","userMessageId":"u"}\n{"type":"delta","text":"Hi"}\n',
      ]),
      () => {},
    );
    expect(last).toEqual({ type: "error", code: "network" });
  });

  it("treats an unexpected response as unknown", async () => {
    const last = await readChatStream(new Response("oops", { status: 500 }), () => {});
    expect(last).toEqual({ type: "error", code: "unknown" });
  });
});
