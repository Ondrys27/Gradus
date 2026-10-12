import { describe, expect, it } from "vitest";
import { costUsd, JARVIS_FEATURES, JARVIS_MODELS, maxTokensFor, modelFor } from "./models";

describe("modelFor", () => {
  it("sends routine work to Haiku, conversation and reviews to Sonnet, analyses to Opus", () => {
    expect(modelFor("classify")).toBe(JARVIS_MODELS.haiku);
    expect(modelFor("check")).toBe(JARVIS_MODELS.haiku);
    expect(modelFor("summary")).toBe(JARVIS_MODELS.haiku);
    expect(modelFor("chat")).toBe(JARVIS_MODELS.sonnet);
    expect(modelFor("milestone_review")).toBe(JARVIS_MODELS.sonnet);
    expect(modelFor("analysis")).toBe(JARVIS_MODELS.opus);
  });

  it("routes every feature and gives analyses the most room", () => {
    for (const feature of JARVIS_FEATURES) expect(modelFor(feature)).toBeTruthy();
    expect(maxTokensFor("classify")).toBeLessThan(maxTokensFor("chat"));
    expect(maxTokensFor("chat")).toBeLessThan(maxTokensFor("analysis"));
  });
});

describe("costUsd", () => {
  it("prices input, output and both cache directions per million tokens", () => {
    // Sonnet 5.5: $2 in, $10 out, cache read $0.10, 5-minute cache write $2.50.
    expect(
      costUsd(JARVIS_MODELS.sonnet, {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
      }),
    ).toBeCloseTo(2 + 10 + 0.1 + 2.5, 6);
  });

  it("rounds a small call to six decimals", () => {
    const cost = costUsd(JARVIS_MODELS.haiku, {
      inputTokens: 1234,
      outputTokens: 321,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    // Haiku 5.5: 1234 × $0.10 + 321 × $0.50 per million.
    expect(cost).toBe(0.000284);
  });

  it("charges Haiku's long-prompt price for the whole request above 100,000 prompt tokens", () => {
    const usage = {
      inputTokens: 1000,
      cacheReadTokens: 99_000,
      cacheWriteTokens: 0,
      outputTokens: 1000,
    };
    // At the threshold: $0.10 in, $0.01 cache read, $0.50 out.
    expect(costUsd(JARVIS_MODELS.haiku, usage)).toBe(0.00159);
    // One token over: $0.50 in, $0.05 cache read, $2.50 out.
    // 500.5 + 4950 + 2500 micro-dollars, rounded to six decimals.
    expect(costUsd(JARVIS_MODELS.haiku, { ...usage, inputTokens: 1001 })).toBe(0.007951);
  });

  it("is zero for a call that never reached the model", () => {
    expect(
      costUsd(JARVIS_MODELS.opus, {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBe(0);
  });
});
