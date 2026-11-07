import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { INDUSTRY_KEYS } from "@/features/onboarding/industries";
import { DEFAULT_FORMAT_SETTINGS } from "@/lib/format";
import { buildDemoPayload } from "./demo-data";

type Messages = Record<string, unknown>;

/** A translator over the real locale file, failing on a missing key. */
function translator(messages: Messages, prefix: string) {
  return (key: string, values: Record<string, string> = {}) => {
    let node: unknown = messages;
    for (const part of `${prefix}.${key}`.split(".")) node = (node as Messages | undefined)?.[part];
    if (typeof node !== "string") throw new Error(`missing ${prefix}.${key}`);
    return node.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`);
  };
}

const load = (locale: string) =>
  JSON.parse(readFileSync(path.resolve(__dirname, `../../locales/${locale}.json`), "utf8"));

describe("buildDemoPayload", () => {
  // A Friday morning in Prague: the next workdays are Monday and Tuesday.
  const now = new Date("2026-11-06T08:00:00Z");
  const settings = { ...DEFAULT_FORMAT_SETTINGS, timeZone: "Europe/Prague", currency: "CZK" };

  it("words the sample data in both languages for every branch", () => {
    for (const locale of ["cs", "en"]) {
      const messages = load(locale);
      for (const industry of INDUSTRY_KEYS) {
        const payload = buildDemoPayload({
          industry,
          settings,
          now,
          t: translator(messages, "tutorial.demo"),
          template: translator(messages, "notes.templates"),
        });
        expect(payload.contacts).toHaveLength(3);
        expect(payload.contacts.every((contact) => contact.email.endsWith("@example.com"))).toBe(true);
        expect(payload.deal.title).toContain(payload.contacts[0]!.company_name);
        expect(payload.milestone.tasks[0]!.children).toHaveLength(2);
        expect(payload.crm_tasks).toHaveLength(2);
        expect(payload.note.content_text.split("\n")[0]).toBe(payload.note.title);
        expect(JSON.stringify(payload)).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it("puts the dates into working days in the user's zone, the Close Date already past", () => {
    const messages = load("cs");
    const payload = buildDemoPayload({
      industry: "trades",
      settings,
      now,
      t: translator(messages, "tutorial.demo"),
      template: translator(messages, "notes.templates"),
    });
    expect(payload.deal.expected_close_date).toBe("2026-11-03");
    expect(payload.deal.value).toBe(25_000);
    // Saturday → Monday 9:00, Sunday → Monday 10:00, Monday → Monday 14:00 (CET = UTC+1).
    expect(payload.crm_tasks.map((task) => task.due_at)).toEqual([
      "2026-11-09T08:00:00.000Z",
      "2026-11-09T09:00:00.000Z",
    ]);
    expect(payload.meeting.starts_at).toBe("2026-11-09T13:00:00.000Z");
    // The ideal customer gets the branch's own question in its outline.
    expect(payload.note.content_text).toContain(messages.notes.templates.idealCustomer.industry.trades);
  });

  it("takes the euro value for any other currency", () => {
    const messages = load("en");
    const payload = buildDemoPayload({
      industry: "other",
      settings: { ...settings, currency: "USD" },
      now,
      t: translator(messages, "tutorial.demo"),
      template: translator(messages, "notes.templates"),
    });
    expect(payload.deal.value).toBe(1_000);
  });
});
