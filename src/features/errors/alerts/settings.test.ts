import { describe, expect, it } from "vitest";
import {
  DEFAULT_DIGEST_MINUTES,
  MAX_ALERT_EMAILS,
  normalizeAlertEmail,
  resolveErrorAlerts,
  toStoredErrorAlerts,
} from "./settings";

describe("error alert settings", () => {
  it("normalises addresses and refuses what is not one", () => {
    expect(normalizeAlertEmail("  Ondrej@Gradus.CZ ")).toBe("ondrej@gradus.cz");
    expect(normalizeAlertEmail("e2e-a@gradus.local")).toBe("e2e-a@gradus.local");
    for (const bad of ["", "ondrej", "a@b", "a b@c.cz", "a@b.c", `${"a".repeat(250)}@b.cz`]) {
      expect(normalizeAlertEmail(bad), bad).toBeNull();
    }
  });

  it("turns the form into the stored value", () => {
    expect(
      toStoredErrorAlerts({ emails: [" A@B.cz "], mode: "digest", digestMinutes: " 30 " }),
    ).toEqual({ ok: true, value: { emails: ["a@b.cz"], mode: "digest", digest_minutes: 30 } });
    // In the "every" mode an unusable N does not stop saving.
    expect(toStoredErrorAlerts({ emails: [], mode: "every", digestMinutes: "x" })).toEqual({
      ok: true,
      value: { emails: [], mode: "every", digest_minutes: DEFAULT_DIGEST_MINUTES },
    });
  });

  it("says what is wrong", () => {
    const many = Array.from({ length: MAX_ALERT_EMAILS + 1 }, (_, i) => `x${i}@gradus.cz`);
    expect(toStoredErrorAlerts({ emails: many, mode: "every", digestMinutes: "15" })).toEqual({
      ok: false,
      problems: ["tooMany"],
    });
    expect(
      toStoredErrorAlerts({
        emails: ["a@b.cz", "A@b.cz", "nope"],
        mode: "digest",
        digestMinutes: "4",
      }),
    ).toEqual({ ok: false, problems: ["emails", "duplicate", "digestMinutes"] });
  });

  it("reads the stored value or falls back to no addresses", () => {
    expect(resolveErrorAlerts({ emails: ["a@b.cz"], mode: "every", digest_minutes: 15 })).toEqual({
      emails: ["a@b.cz"],
      mode: "every",
      digest_minutes: 15,
      stored: true,
    });
    expect(resolveErrorAlerts(null)).toMatchObject({ emails: [], mode: "every", stored: false });
    expect(resolveErrorAlerts({ emails: "x" })).toMatchObject({ stored: false });
  });
});
