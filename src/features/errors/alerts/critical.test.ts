import { describe, expect, it } from "vitest";
import { CRITICAL_CRON_JOB, isCriticalPlace } from "./critical";
import { DEFAULT_ERROR_ALERTS, ERROR_ALERT_MODES, errorAlertSettingsSchema } from "./settings";

describe("critical errors", () => {
  it("are the crashes of signing in, signing up and payments", () => {
    for (const page of [
      "/prihlaseni",
      "/en/login",
      "/registrace",
      "/en/register",
      "/zapomenute-heslo",
      "/api/stripe/webhook",
      "/app/nastaveni/predplatne",
      "/auth/confirm",
    ]) {
      expect(isCriticalPlace(page, null), page).toBe(true);
    }
    expect(isCriticalPlace("/api/cron/recurring-payments", CRITICAL_CRON_JOB)).toBe(true);
    expect(isCriticalPlace("/x", "/api/stripe/webhook")).toBe(true);
  });

  it("are not the rest of the app", () => {
    for (const page of ["/app", "/app/finance", "/app/pipeline", "/prihlasenix", "/app/nastaveni/ucet"]) {
      expect(isCriticalPlace(page, null), page).toBe(false);
    }
  });
});

describe("the alert modes", () => {
  it("are off by default and offer off, critical, digest and every", () => {
    expect(DEFAULT_ERROR_ALERTS.mode).toBe("off");
    expect([...ERROR_ALERT_MODES]).toEqual(["off", "critical", "digest", "every"]);
    for (const mode of ERROR_ALERT_MODES) {
      expect(errorAlertSettingsSchema.safeParse({ emails: [], mode, digest_minutes: 15 }).success).toBe(true);
    }
  });
});
