import { describe, expect, it } from "vitest";
import { EMAIL_BODY_MAX, emailSummary } from "./types";

describe("emailSummary", () => {
  it("puts the subject before the body, separated by a blank line", () => {
    expect(emailSummary("Nabídka", "Dobrý den,\n\nposílám nabídku.")).toBe(
      "Nabídka\n\nDobrý den,\n\nposílám nabídku.",
    );
  });

  it("is just the body when there is no subject", () => {
    expect(emailSummary("  ", "Jen text.")).toBe("Jen text.");
  });

  it("never exceeds the activity's content limit", () => {
    const long = "a".repeat(EMAIL_BODY_MAX + 500);
    expect(emailSummary("S", long).length).toBe(EMAIL_BODY_MAX);
  });
});
