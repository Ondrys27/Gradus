import { describe, expect, it } from "vitest";
import { summarizeEfficiency, type EfficiencyRow } from "./ai-efficiency";

const day = (date: string | null, over: Partial<EfficiencyRow> = {}): EfficiencyRow => ({
  day: date,
  activeUsers: 10,
  aiUsers: 5,
  costUsd: 1,
  calls: 100,
  inputTokens: 600,
  cacheReadTokens: 300,
  cacheWriteTokens: 100,
  chatCostUsd: 0.5,
  chatAnswers: 50,
  batchCostUsd: 0.1,
  ...over,
});

describe("Grady's cost per user", () => {
  it("averages a day, scales the period to a month by distinct active users", () => {
    const efficiency = summarizeEfficiency([
      day("2026-11-01"),
      day("2026-11-02", { costUsd: 3, activeUsers: 10 }),
      day(null, { activeUsers: 15, costUsd: 4, chatCostUsd: 1, chatAnswers: 100, batchCostUsd: 0.2 }),
    ]);
    expect(efficiency.perActiveUserDayUsd).toBeCloseTo((0.1 + 0.3) / 2, 9);
    expect(efficiency.perActiveUserMonthUsd).toBeCloseTo((4 / 15) * 15, 9);
    expect(efficiency.chatAnswerUsd).toBeCloseTo(0.01, 9);
    expect(efficiency.cacheShare).toBeCloseTo(0.3, 9);
    expect(efficiency.batchShare).toBeCloseTo(0.05, 9);
    expect(efficiency.trend.perActiveUser).toBeCloseTo(2, 9);
  });

  it("has nothing to say without active users or days", () => {
    const empty = summarizeEfficiency([day(null, { activeUsers: 0, costUsd: 0, chatAnswers: 0 })]);
    expect(empty.perActiveUserDayUsd).toBeNull();
    expect(empty.perActiveUserMonthUsd).toBeNull();
    expect(empty.chatAnswerUsd).toBeNull();
    expect(empty.trend.perActiveUser).toBeNull();
  });
});
