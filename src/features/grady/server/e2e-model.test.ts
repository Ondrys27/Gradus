// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  E2E_ECHO_NOTES,
  E2E_ECHO_SUMMARY,
  E2E_MODEL_HEADER,
  E2E_NO_NOTES,
  E2E_SUMMARY_TEXT,
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
});
