import { describe, expect, it } from "vitest";
import { estimateCompare, tokensOf, TYPICAL_OUTPUT } from "./estimate";

describe("the estimate before a comparison", () => {
  const base = {
    feature: "briefing" as const,
    sampleChars: [2_100, 2_100, 2_100],
    observedOutput: null,
    judge: "haiku" as const,
  };

  it("prices every sample on every model, plus one grade per answer", () => {
    const estimate = estimateCompare({ ...base, models: ["haiku", "sonnet"] });
    expect(estimate.calls).toBe(12);
    expect(estimate.perModel.sonnet).toBeGreaterThan(estimate.perModel.haiku * 10);
    expect(estimate.judgeUsd).toBeGreaterThan(0);
    expect(estimate.totalUsd).toBeCloseTo(
      estimate.perModel.haiku + estimate.perModel.sonnet + estimate.judgeUsd,
      9,
    );
  });

  it("is on the safe side: thinking models write more, all input at the full price", () => {
    const one = estimateCompare({ ...base, models: ["sonnet"], sampleChars: [2_100], judge: null });
    // 1,000 input tokens on Sonnet = 0.002 USD; 200 output + half for thinking = 300 × 10 / 1M.
    expect(tokensOf(2_100)).toBe(1_000);
    expect(TYPICAL_OUTPUT.briefing).toBe(200);
    expect(one.perModel.sonnet).toBeCloseTo(0.002 + 0.003, 6);
    expect(one.judgeUsd).toBe(0);
  });

  it("takes the job's real average output when there is one, never above the job's cap", () => {
    const observed = estimateCompare({ ...base, models: ["haiku"], observedOutput: 900 });
    const typical = estimateCompare({ ...base, models: ["haiku"] });
    expect(observed.perModel.haiku).toBeGreaterThan(typical.perModel.haiku);
    const huge = estimateCompare({ ...base, models: ["haiku"], observedOutput: 1_000_000 });
    // Haiku's cap for the brief is 1,024 tokens.
    expect(huge.perModel.haiku).toBeLessThan(0.01);
  });

  it("costs nothing without models or samples", () => {
    expect(estimateCompare({ ...base, models: [] }).totalUsd).toBe(0);
    expect(estimateCompare({ ...base, models: ["opus"], sampleChars: [] }).totalUsd).toBe(0);
  });
});
