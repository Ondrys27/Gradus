import { describe, expect, it } from "vitest";
import {
  clientBlock,
  DEFAULT_PROACTIVE_RULES,
  GAP_HOURS,
  MIN_GAP_HOURS,
  nextAllowedAt,
  PAGE_SETTLE_MS,
  PROACTIVE_SUGGESTION_TYPES,
  proactiveTypeEnabled,
  questionAllowed,
  QUESTIONS_PER_WEEK,
  serverBlock,
  SUGGESTION_FRESH_DAYS,
} from "./proactive";
import {
  DEFAULT_JARVIS_RULES,
  jarvisRulesFormSchema,
  OWNER_INSTRUCTIONS_MAX,
  resolveJarvisRules,
  storedJarvisRulesSchema,
  toJarvisRulesForm,
  toStoredJarvisRules,
} from "./rules";

const STORED = {
  suggestion_types: { insight: false, followUps: false },
  questions: false,
  min_gap_hours: 8,
  questions_per_week: 1,
  suggestion_fresh_days: 5,
  page_settle_seconds: 60,
  instructions: "Mluv česky a tykej.",
};

describe("the defaults", () => {
  it("are today's constants", () => {
    expect(DEFAULT_JARVIS_RULES).toMatchObject({
      minGapHours: MIN_GAP_HOURS,
      questionsPerWeek: QUESTIONS_PER_WEEK,
      suggestionFreshDays: SUGGESTION_FRESH_DAYS,
      pageSettleMs: PAGE_SETTLE_MS,
      questions: true,
      instructions: "",
      source: "default",
    });
    expect(Object.values(DEFAULT_JARVIS_RULES.suggestionTypes).every(Boolean)).toBe(true);
    expect(Object.keys(DEFAULT_JARVIS_RULES.suggestionTypes)).toEqual([...PROACTIVE_SUGGESTION_TYPES]);
  });

  it("apply without a stored value or with a broken one", () => {
    expect(resolveJarvisRules(null)).toBe(DEFAULT_JARVIS_RULES);
    expect(resolveJarvisRules({ ...STORED, min_gap_hours: 1 })).toBe(DEFAULT_JARVIS_RULES);
    expect(resolveJarvisRules({ ...STORED, extra: true })).toBe(DEFAULT_JARVIS_RULES);
    expect(
      resolveJarvisRules({ ...STORED, instructions: "x".repeat(OWNER_INSTRUCTIONS_MAX + 1) }),
    ).toBe(DEFAULT_JARVIS_RULES);
  });
});

describe("the stored rules", () => {
  const rules = resolveJarvisRules(STORED);

  it("are read with every type a switch, missing ones on", () => {
    expect(rules.source).toBe("database");
    expect(rules.pageSettleMs).toBe(60_000);
    expect(rules.suggestionTypes).toMatchObject({ insight: false, followUps: false, overdueTask: true });
    expect(rules.instructions).toBe("Mluv česky a tykej.");
  });

  it("win over the constants in every check", () => {
    const now = new Date("2026-10-03T10:00:00Z");
    // Every 2 hours by the user's frequency, but never sooner than the owner's 8.
    expect(nextAllowedAt("2026-10-03T09:00:00Z", "every_2h")).toBe(
      Date.parse("2026-10-03T11:00:00Z"),
    );
    expect(nextAllowedAt("2026-10-03T09:00:00Z", "every_2h", rules)).toBe(
      Date.parse("2026-10-03T17:00:00Z"),
    );
    const settings = {
      enabled: true,
      frequency: "every_6h" as const,
      quietFrom: null,
      quietTo: null,
      timeZone: "Europe/Prague",
    };
    expect(serverBlock({ now, settings, lastShownAt: "2026-10-03T03:00:00Z" })).toBeNull();
    expect(serverBlock({ now, settings, lastShownAt: "2026-10-03T03:00:00Z", rules })).toBe("tooSoon");
    // A floor only: the 6 hours of "sometimes" stay when the owner's floor is lower.
    expect(GAP_HOURS.every_6h).toBe(6);
    expect(
      nextAllowedAt("2026-10-03T00:00:00Z", "every_6h", { ...rules, minGapHours: 2 }),
    ).toBe(Date.parse("2026-10-03T06:00:00Z"));

    expect(questionAllowed(1)).toBe(true);
    expect(questionAllowed(1, rules)).toBe(false);
    expect(questionAllowed(0, { ...rules, questions: true })).toBe(true);
    expect(questionAllowed(0, { ...DEFAULT_PROACTIVE_RULES, questionsPerWeek: 0 })).toBe(false);

    expect(proactiveTypeEnabled("insight")).toBe(true);
    expect(proactiveTypeEnabled("insight", rules)).toBe(false);
    expect(proactiveTypeEnabled("overdueTask", rules)).toBe(true);
    expect(proactiveTypeEnabled("dealWon", rules)).toBe(false);

    const page = { now: 45_000, pageSince: 0, shownThisSession: false, timerRunning: false, dialogOpen: false, busy: false, visible: true };
    expect(clientBlock(page)).toBeNull();
    expect(clientBlock({ ...page, settleMs: rules.pageSettleMs })).toBe("settling");
  });
});

describe("the form", () => {
  it("round-trips to the stored value the database accepts", () => {
    const form = toJarvisRulesForm(resolveJarvisRules(STORED));
    const parsed = jarvisRulesFormSchema.parse({
      ...form,
      minGapHours: "8",
      instructions: "  Mluv česky a tykej.\r\n",
    });
    const stored = toStoredJarvisRules(parsed);
    expect(storedJarvisRulesSchema.safeParse(stored).success).toBe(true);
    expect(resolveJarvisRules(stored)).toEqual(resolveJarvisRules(STORED));
  });

  it("refuses numbers out of bounds, fractions and too long instructions", () => {
    const form = toJarvisRulesForm(DEFAULT_JARVIS_RULES);
    for (const patch of [
      { minGapHours: "1" },
      { minGapHours: "73" },
      { questionsPerWeek: "8" },
      { suggestionFreshDays: "0" },
      { pageSettleSeconds: "5" },
      { pageSettleSeconds: "1.5" },
      { instructions: "x".repeat(OWNER_INSTRUCTIONS_MAX + 1) },
    ]) {
      expect(jarvisRulesFormSchema.safeParse({ ...form, ...patch }).success, JSON.stringify(patch).slice(0, 40)).toBe(false);
    }
    expect(jarvisRulesFormSchema.safeParse(form).success).toBe(true);
  });
});
