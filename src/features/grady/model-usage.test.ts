import { describe, expect, it } from "vitest";
import { GRADY_MODELS } from "./models";
import { perThousandCalls, summarizeModelUsage, type ModelUsageRow } from "./model-usage";

const row = (changes: Partial<ModelUsageRow>): ModelUsageRow => ({
  purpose: "chat",
  model: GRADY_MODELS.sonnet,
  routedFrom: null,
  longPrompt: false,
  calls: 1,
  tokens: { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
  costUsd: 0,
  ...changes,
});

describe("summarizeModelUsage", () => {
  it("sums calls and cost by job and prices the same tokens on every model", () => {
    const tokens = { inputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 100_000 };
    const summary = summarizeModelUsage([
      row({ purpose: "briefing", calls: 10, tokens, costUsd: 3 }),
      row({ purpose: "unknown_job", calls: 2, costUsd: 1 }),
    ]);
    const briefing = summary.features.briefing;
    expect(briefing.calls).toBe(10);
    expect(briefing.costUsd).toBe(3);
    // 1M in + 100k out: Haiku 0.10 + 0.05, Sonnet 2 + 1, Opus 4 + 2, Fable 8 + 4.
    expect(briefing.estimates).toEqual({ haiku: 0.15, sonnet: 3, opus: 6, fable: 12 });
    // An unknown job counts to the total, not to a row.
    expect(summary.total.calls).toBe(12);
    expect(summary.total.costUsd).toBe(4);
  });

  it("prices Haiku's long prompts at the long-prompt price", () => {
    const tokens = { inputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
    const short = summarizeModelUsage([row({ purpose: "classify", tokens })]);
    const long = summarizeModelUsage([row({ purpose: "classify", tokens, longPrompt: true })]);
    expect(short.features.classify.estimates.haiku).toBe(0.1);
    expect(long.features.classify.estimates.haiku).toBe(0.5);
    expect(long.features.classify.estimates.sonnet).toBe(2);
  });

  it("counts what the automatic choice and economy mode saved, net of the routing calls", () => {
    const tokens = { inputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 10_000 };
    const summary = summarizeModelUsage([
      // Routed to Haiku: 0.01 + 0.005 = 0.015 instead of Sonnet's 0.2 + 0.1 = 0.3.
      row({ model: GRADY_MODELS.haiku, routedFrom: GRADY_MODELS.sonnet, tokens, costUsd: 0.015 }),
      // Routed and kept on Sonnet: nothing saved.
      row({ routedFrom: GRADY_MODELS.sonnet, tokens, costUsd: 0.3 }),
      row({ purpose: "chat_route", model: GRADY_MODELS.haiku, calls: 2, costUsd: 0.005 }),
      // Set by hand: not routed.
      row({ tokens, costUsd: 0.3 }),
    ]);
    expect(summary.routing.calls).toBe(2);
    expect(summary.routing.baselineUsd).toBeCloseTo(0.6, 6);
    expect(summary.routing.costUsd).toBeCloseTo(0.315, 6);
    expect(summary.routing.routeCostUsd).toBeCloseTo(0.005, 6);
    expect(summary.routing.savedUsd).toBeCloseTo(0.28, 6);
    expect(summary.features.chat_route.calls).toBe(2);
  });
});

describe("perThousandCalls", () => {
  it("gives the average price of 1,000 calls, or null without calls", () => {
    expect(perThousandCalls({ calls: 500, costUsd: 0.2 })).toBeCloseTo(0.4, 6);
    expect(perThousandCalls({ calls: 0, costUsd: 0 })).toBeNull();
  });
});
