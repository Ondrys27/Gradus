import { describe, expect, it } from "vitest";
import { DEFAULT_FORMAT_SETTINGS } from "@/lib/format";
import { createTranslator } from "next-intl";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";
import { ownerDigest, type OwnerAlertRow } from "./owner-alerts";

const settings = { ...DEFAULT_FORMAT_SETTINGS, timeZone: "Europe/Prague" };

const alert = (overrides: Partial<OwnerAlertRow>): OwnerAlertRow => ({
  id: crypto.randomUUID(),
  kind: "first_payment",
  userId: "u1",
  mode: "live",
  planKey: "pro",
  billing: "monthly",
  amount: 890,
  currency: "CZK",
  createdAt: "2026-11-09T09:00:00Z",
  ...overrides,
});

function digest(alerts: OwnerAlertRow[], locale = "cs") {
  const t = createTranslator({ locale, messages: (locale === "en" ? en : cs) as typeof en });
  return ownerDigest({
    alerts,
    who: (id) => (id === "u1" ? "jana@example.com" : id),
    planName: (key) => key.toUpperCase(),
    adminUrl: (id) => `https://gradus.test/admin/uzivatele/${id}`,
    t: (key, values) => t(key as never, values as never),
    settings,
    appName: "Gradus",
  });
}

describe("the owner's digest of payments", () => {
  it("says nothing without alerts", () => {
    expect(digest([])).toBeNull();
  });

  it("lists first payments, then subscriptions ended for non-payment, with links to the account", () => {
    const mail = digest([
      alert({ kind: "final_failure", userId: "u2", amount: null, currency: null, createdAt: "2026-11-09T08:00:00Z" }),
      alert({}),
    ])!;
    expect(mail.subject).toBe("Gradus: 1 první platba, 1 předplatné skončilo pro neplacení");
    const text = mail.lines.join("\n");
    expect(text.indexOf("jana@example.com")).toBeLessThan(text.indexOf("u2"));
    expect(text).toContain("PRO · měsíčně");
    expect(text).toContain("890");
    expect(text).toContain("https://gradus.test/admin/uzivatele/u1");
    expect(text).toContain("jen pro čtení");
    expect(text).not.toContain("testovací režim");
  });

  it("marks the test mode and speaks English to an English owner", () => {
    const mail = digest([alert({ mode: "test" }), alert({ userId: "u3" })], "en")!;
    expect(mail.subject).toBe("Gradus: 2 first payments, 0 subscriptions ended for non-payment");
    expect(mail.lines.join("\n")).toContain("test mode");
  });
});
