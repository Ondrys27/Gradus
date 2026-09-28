import { describe, expect, it } from "vitest";
import {
  calendarDaysBetween,
  isAppHref,
  ruleSuggestions,
  suggestionActionSchema,
  type RuleInputs,
} from "./suggestions";

const EMPTY: RuleInputs = {
  wonDeals: [],
  followUps: { total: 0, firstName: null, tableId: null, today: "2026-09-28" },
  stalledDeals: [],
  overdueTasks: [],
  readyMilestones: [],
};

describe("ruleSuggestions", () => {
  it("says nothing when nothing happened", () => {
    expect(ruleSuggestions(EMPTY)).toEqual([]);
  });

  it("turns each instant trigger into one suggestion with a stable key", () => {
    const rules = ruleSuggestions({
      wonDeals: [{ id: "d1", title: "Acme", contactName: "Jana" }],
      followUps: { total: 4, firstName: "Petr", tableId: "t1", today: "2026-09-28" },
      stalledDeals: [
        {
          id: "d2",
          title: "Beta",
          stageName: "Offer",
          enteredStageAt: "2026-09-01T10:00:00Z",
          days: 27,
        },
      ],
      overdueTasks: [
        { id: "k1", title: "Call", milestoneId: "m1", dueDate: "2026-09-20", daysLate: 8 },
      ],
      readyMilestones: [{ id: "m2", title: "Launch" }],
    });

    expect(rules.map((r) => [r.type, r.dedupeKey])).toEqual([
      ["dealWon", "dealWon:d1"],
      ["followUps", "followUps:2026-09-28"],
      ["stalledDeal", "stalledDeal:d2:2026-09-01"],
      ["overdueTask", "overdueTask:k1:2026-09-20"],
      ["milestoneReady", "milestoneReady:m2"],
    ]);
    expect(rules[1].action).toEqual({
      kind: "open",
      href: "/contacts?table=t1",
      params: { count: 4, name: "Petr" },
    });
    expect(rules[2].action).toMatchObject({ kind: "ask", prompt: "", params: { days: 27 } });
    // A milestone is only pointed to, never finished.
    expect(rules[4].action).toEqual({
      kind: "open",
      href: "/milestones/m2",
      params: { milestone: "Launch" },
    });
    for (const rule of rules)
      expect(suggestionActionSchema.safeParse(rule.action).success).toBe(true);
  });

  it("keeps at most three of a kind", () => {
    const deals = Array.from({ length: 6 }, (_, i) => ({
      id: `d${i}`,
      title: `Deal ${i}`,
      contactName: null,
    }));
    expect(ruleSuggestions({ ...EMPTY, wonDeals: deals })).toHaveLength(3);
  });
});

describe("suggestion actions", () => {
  it("opens only places inside the app", () => {
    expect(isAppHref("/pipeline")).toBe(true);
    expect(isAppHref("/milestones/5b2c")).toBe(true);
    expect(isAppHref("/contacts?table=abc")).toBe(true);
    expect(isAppHref("https://evil.example")).toBe(false);
    expect(isAppHref("//evil.example")).toBe(false);
    expect(isAppHref("/settings")).toBe(false);
    expect(isAppHref("/pipelinex")).toBe(false);
    expect(isAppHref("javascript:alert(1)")).toBe(false);
    expect(
      suggestionActionSchema.safeParse({ kind: "open", href: "https://evil.example" }).success,
    ).toBe(false);
    expect(
      suggestionActionSchema.safeParse({
        kind: "undoTask",
        taskId: "not-a-uuid",
        previousStatus: "todo",
      }).success,
    ).toBe(false);
  });

  it("counts calendar days", () => {
    expect(calendarDaysBetween("2026-09-20", "2026-09-28")).toBe(8);
    expect(calendarDaysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });
});
