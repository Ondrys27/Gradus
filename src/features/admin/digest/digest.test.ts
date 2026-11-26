import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";
import { ADMIN_FORMAT_SETTINGS } from "../format-metric";
import { composeDigest, type Translate } from "./compose";
import { attentionOf, hasNews, type DigestFacts } from "./facts";
import { digestPrefsOf, digestSendAt, digestZone } from "./schedule";

const tCs = createTranslator({ locale: "cs", messages: cs }) as unknown as Translate;
const tEn = createTranslator({ locale: "en", messages: en }) as unknown as Translate;

function facts(overrides: Partial<DigestFacts> = {}): DigestFacts {
  return {
    day: "2026-11-25",
    newUsers: { value: 4, dayBefore: 4, weekAgo: 3 },
    activeUsers: { value: 30, dayBefore: 29, weekAgo: 28 },
    money: { testMode: false, revenue: [{ currency: "CZK", value: 980, dayBefore: 490 }], started: 1, cancelled: 0 },
    ai: { spentUsd: 1.2, dayBeforeUsd: 1.1, perActiveUsd: 0.04, perActiveDayBeforeUsd: 0.038 },
    errors: { newGroups: 0, occurrences: 0, top: [], resolved: 0 },
    feedback: { reports: 0, ideas: 0, survey: 0 },
    waiting: { errors: 0, reports: 0, payouts: 0, draft: 0 },
    health: [],
    ...overrides,
  };
}

const full = { money: true };
const limited = { money: false };

describe("attentionOf", () => {
  it("puts a failing system first, then new errors", () => {
    const day = facts({
      health: [{ key: "rates", status: "warn" }, { key: "cron", status: "bad" }],
      errors: { newGroups: 2, occurrences: 9, top: [{ code: "GR-ABC123", message: "TypeError", occurrences: 7 }], resolved: 0 },
    });
    expect(attentionOf(day, full)).toEqual({ kind: "health", key: "cron" });
    expect(attentionOf({ ...day, health: [] }, full)).toEqual({ kind: "newErrors", count: 2, code: "GR-ABC123" });
  });

  it("picks the largest change of the day, never a money reason for a limited admin", () => {
    const day = facts({
      newUsers: { value: 12, dayBefore: 4, weekAgo: 5 },
      activeUsers: { value: 40, dayBefore: 30, weekAgo: 30 },
    });
    expect(attentionOf(day, full)).toEqual({ kind: "signups", value: 12, previous: 4, versus: "dayBefore" });
    const ai = facts({ ai: { spentUsd: 4, dayBeforeUsd: 1, perActiveUsd: 0.13, perActiveDayBeforeUsd: 0.03 } });
    expect(attentionOf(ai, full).kind).toBe("aiCost");
    expect(attentionOf(ai, limited)).toEqual({ kind: "calm" });
    const cancelled = facts({ money: { ...facts().money, cancelled: 2 } });
    expect(attentionOf(cancelled, full)).toEqual({ kind: "cancelled", count: 2 });
    expect(attentionOf(cancelled, limited)).toEqual({ kind: "calm" });
  });

  it("ignores small changes: a quiet day is calm", () => {
    expect(attentionOf(facts({ newUsers: { value: 2, dayBefore: 1, weekAgo: 0 } }), full)).toEqual({ kind: "calm" });
    expect(hasNews(facts(), full)).toBe(false);
    expect(hasNews(facts({ feedback: { reports: 1, ideas: 0, survey: 0 } }), full)).toBe(true);
    expect(hasNews(facts({ money: { ...facts().money, cancelled: 1 } }), limited)).toBe(false);
  });
});

describe("composeDigest", () => {
  const urls = { adminUrl: "https://www.gradusgo.com/admin", settingsUrl: "https://www.gradusgo.com/admin/upozorneni" };

  it("is a short all-is-well e-mail with the numbers on a calm day", () => {
    const mail = composeDigest({ facts: facts(), audience: full, t: tCs, settings: ADMIN_FORMAT_SETTINGS, ...urls });
    expect(mail.calm).toBe(true);
    expect(mail.subject).toBe("Gradus včera · 25. 11. 2026 · vše v pořádku");
    expect(mail.text).toContain("Vše v pořádku");
    // Intl writes a no-break space before % and the currency.
    expect(mail.text).toMatch(/Noví uživatelé: 4 · stejně jako den předtím · \+1 \(\+33\s%\) proti minulému týdnu/);
    expect(mail.text).toMatch(/Tržby: 980,00\sKč · \+490,00\sKč \(\+100\s%\) proti předchozímu dni/);
    expect(mail.text).not.toContain("Chyby");
    expect(mail.html).toContain('href="https://www.gradusgo.com/admin"');
  });

  it("leaves money and AI costs out for a limited admin", () => {
    const mail = composeDigest({ facts: facts(), audience: limited, t: tCs, settings: ADMIN_FORMAT_SETTINGS, ...urls });
    expect(mail.text).not.toMatch(/Tržby|Náklady AI|Kč|USD/);
  });

  it("lists new errors with codes, waiting work, failing systems, and marks Stripe's test mode", () => {
    const mail = composeDigest({
      facts: facts({
        money: { ...facts().money, testMode: true },
        errors: {
          newGroups: 2,
          occurrences: 11,
          top: [
            { code: "GR-ABC123", message: "TypeError: <b>x</b>", occurrences: 8 },
            { code: "GR-DEF456", message: "Error: boom", occurrences: 3 },
          ],
          resolved: 1,
        },
        waiting: { errors: 5, reports: 1, payouts: 2, draft: 1 },
        health: [{ key: "stripe", status: "bad" }],
      }),
      audience: full,
      t: tEn,
      settings: ADMIN_FORMAT_SETTINGS,
      ...urls,
    });
    expect(mail.calm).toBe(false);
    expect(mail.text).toContain("Something is failing: Stripe webhook.");
    expect(mail.text).toContain("GR-ABC123 · TypeError: <b>x</b> · 8×");
    expect(mail.html).toContain("TypeError: &#60;b&#62;x&#60;/b&#62;");
    expect(mail.text).toContain("Errors to triage: 5");
    expect(mail.text).toContain("Commission payouts to approve or pay: 2");
    expect(mail.text).toContain("Stripe is in test mode");
  });
});

describe("digest schedule", () => {
  it("reads the stored prefs with sane defaults", () => {
    expect(digestPrefsOf(null)).toEqual({ enabled: true, hour: 6, onlyNews: false, timeZone: null });
    expect(digestPrefsOf({ digest_enabled: false, digest_hour: 31, digest_time_zone: "Mars/Base" })).toEqual({
      enabled: false,
      hour: 6,
      onlyNews: false,
      timeZone: null,
    });
    expect(digestZone(digestPrefsOf(null), "America/New_York")).toBe("America/New_York");
    expect(digestZone(digestPrefsOf(null), null)).toBe("Europe/Prague");
  });

  it("schedules 6:00 in the administrator's zone, or sends at once when it is past", () => {
    const run = Date.parse("2026-11-26T02:30:00Z"); // the daily job, 3:30 in Prague
    expect(digestSendAt(6, "Europe/Prague", "2026-11-25", run)).toBe("2026-11-26T05:00:00.000Z");
    expect(digestSendAt(6, "America/New_York", "2026-11-25", run)).toBe("2026-11-26T11:00:00.000Z");
    expect(digestSendAt(6, "Asia/Tokyo", "2026-11-25", run)).toBeNull();
    // Summer time: 6:00 in Prague is 4:00 UTC.
    expect(digestSendAt(6, "Europe/Prague", "2026-06-30", Date.parse("2026-07-01T02:10:00Z"))).toBe("2026-07-01T04:00:00.000Z");
  });
});
