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
    // Sonnet: $2 in, $10 out; cache read 0.1×, cache write 1.25× of input.
    expect(
      costUsd(JARVIS_MODELS.sonnet, {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
      }),
    ).toBeCloseTo(2 + 10 + 0.2 + 2.5, 6);
  });

  it("rounds a small call to six decimals", () => {
    const cost = costUsd(JARVIS_MODELS.haiku, {
      inputTokens: 1234,
      outputTokens: 321,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(cost).toBe(0.002839);
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
