// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { E2E_ECHO_NOTES, E2E_MODEL_HEADER, E2E_NO_NOTES, echoedNotes, wantsE2eEcho } = await import(
  "./e2e-model"
);

const headers = (value: string | null) => new Headers(value ? { [E2E_MODEL_HEADER]: value } : {});

describe("the end-to-end echo model", () => {
  it("is only for the tests' own accounts, on request, never in production", () => {
    const email = "e2e-notes-ab12cd34@gradus.local";
    expect(wantsE2eEcho(headers(E2E_ECHO_NOTES), email, "development")).toBe(true);
    expect(wantsE2eEcho(headers(E2E_ECHO_NOTES), email, "production")).toBe(false);
    expect(wantsE2eEcho(headers(null), email, "development")).toBe(false);
    expect(wantsE2eEcho(headers("other"), email, "development")).toBe(false);
    expect(wantsE2eEcho(headers(E2E_ECHO_NOTES), "ondrej@example.com", "development")).toBe(false);
    expect(wantsE2eEcho(headers(E2E_ECHO_NOTES), "e2e-x@gradus.local.evil.com", "development")).toBe(
      false,
    );
    expect(wantsE2eEcho(headers(E2E_ECHO_NOTES), null, "development")).toBe(false);
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
