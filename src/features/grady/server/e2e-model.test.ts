// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  E2E_ECHO_NOTES,
  E2E_ECHO_SUMMARY,
  E2E_MODEL_HEADER,
  E2E_NO_NOTES,
  E2E_SUMMARY_TEXT,
  e2eEchoClient,
  echoedAsk,
  echoedNotes,
  wantsE2eEcho,
} = await import("./e2e-model");

const headers = (value: string | null) => new Headers(value ? { [E2E_MODEL_HEADER]: value } : {});

describe("the end-to-end echo model", () => {
  it("is only for the tests' own accounts, on request, never in production", () => {
    const email = "e2e-notes-ab12cd34@gradus.local";
    expect(wantsE2eEcho(headers(E2E_ECHO_NOTES), email, "echo-notes", "development")).toBe(true);
    expect(wantsE2eEcho(headers(E2E_ECHO_NOTES), email, "echo-notes", "production")).toBe(false);
    expect(wantsE2eEcho(headers(null), email, "echo-notes", "development")).toBe(false);
    expect(wantsE2eEcho(headers("other"), email, "echo-notes", "development")).toBe(false);
    expect(wantsE2eEcho(headers(E2E_ECHO_NOTES), "ondrej@example.com", "echo-notes", "development")).toBe(false);
    expect(wantsE2eEcho(headers(E2E_ECHO_NOTES), "e2e-x@gradus.local.evil.com", "echo-notes", "development")).toBe(
      false,
    );
    expect(wantsE2eEcho(headers(E2E_ECHO_NOTES), null, "echo-notes", "development")).toBe(false);
    // Each stand-in only on its own header.
    expect(wantsE2eEcho(headers(E2E_ECHO_NOTES), email, E2E_ECHO_SUMMARY, "development")).toBe(false);
    expect(wantsE2eEcho(headers(E2E_ECHO_SUMMARY), email, E2E_ECHO_SUMMARY, "development")).toBe(
      true,
    );
    expect(wantsE2eEcho(headers(E2E_ECHO_SUMMARY), email, E2E_ECHO_SUMMARY, "production")).toBe(
      false,
    );
  });

  it("writes the summary as a fixed line naming what it was asked for", () => {
    expect(echoedAsk({ messages: [{ role: "user", content: "Write today's brief." }] })).toBe(
      `${E2E_SUMMARY_TEXT}: Write today's brief.`,
    );
  });

  it("answers with the notes block of the system prompt", () => {
    const system = [
      { type: "text" as const, text: "persona" },
      { type: "text" as const, text: "<situation>…</situation>\n<user_notes>\nCeník\n</user_notes>" },
    ];
    expect(echoedNotes({ system })).toBe("<user_notes>\nCeník\n</user_notes>");
    expect(echoedNotes({ system: "nothing here" })).toBe(E2E_NO_NOTES);
  });

  it("streams like the tools loop reads it: events, then the whole message", async () => {
    const client = e2eEchoClient({} as never);
    const stream = client.messages.stream({
      model: "claude-sonnet-5-5",
      max_tokens: 10,
      system: "<user_notes>\nCeník\n</user_notes>",
      messages: [{ role: "user", content: "?" }],
    }) as unknown as AsyncIterable<{ type: string }> & {
      finalMessage: () => Promise<{ stop_reason: string; content: { type: string; text: string }[] }>;
    };
    const types: string[] = [];
    for await (const event of stream) types.push(event.type);
    expect(types).toEqual(["message_start", "content_block_delta", "message_delta"]);
    const message = await stream.finalMessage();
    expect(message.stop_reason).toBe("end_turn");
    expect(message.content).toEqual([
      expect.objectContaining({ type: "text", text: "<user_notes>\nCeník\n</user_notes>" }),
    ]);
  });
});
