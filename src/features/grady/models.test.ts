import { describe, expect, it } from "vitest";
import { costUsd, GRADY_FEATURES, GRADY_MODELS, maxTokensFor, modelFor } from "./models";

describe("modelFor", () => {
  it("sends routine work to Haiku, conversation and reviews to Sonnet, analyses to Opus", () => {
    expect(modelFor("classify")).toBe(GRADY_MODELS.haiku);
    expect(modelFor("check")).toBe(GRADY_MODELS.haiku);
    expect(modelFor("summary")).toBe(GRADY_MODELS.haiku);
    expect(modelFor("chat")).toBe(GRADY_MODELS.sonnet);
    expect(modelFor("milestone_review")).toBe(GRADY_MODELS.sonnet);
    expect(modelFor("analysis")).toBe(GRADY_MODELS.opus);
  });

  it("routes every feature and gives analyses the most room", () => {
    for (const feature of GRADY_FEATURES) expect(modelFor(feature)).toBeTruthy();
    expect(maxTokensFor("classify")).toBeLessThan(maxTokensFor("chat"));
    expect(maxTokensFor("chat")).toBeLessThan(maxTokensFor("analysis"));
  });
});

describe("costUsd", () => {
  it("prices input, output and both cache directions per million tokens", () => {
    // Sonnet 5.5: $2 in, $10 out, cache read $0.10, 5-minute cache write $2.50.
    expect(
      costUsd(GRADY_MODELS.sonnet, {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
      }),
    ).toBeCloseTo(2 + 10 + 0.1 + 2.5, 6);
  });

  it("rounds a small call to six decimals", () => {
    const cost = costUsd(GRADY_MODELS.haiku, {
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
    expect(costUsd(GRADY_MODELS.haiku, usage)).toBe(0.00159);
    // One token over: $0.50 in, $0.05 cache read, $2.50 out.
    // 500.5 + 4950 + 2500 micro-dollars, rounded to six decimals.
    expect(costUsd(GRADY_MODELS.haiku, { ...usage, inputTokens: 1001 })).toBe(0.007951);
  });

  it("is zero for a call that never reached the model", () => {
    expect(
      costUsd(GRADY_MODELS.opus, {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBe(0);
  });
});

describe("step 28.9: output caps by job and the batch price", () => {
  it("caps routine jobs below the model's own cap, never the chat", () => {
    expect(maxTokensFor("briefing", GRADY_MODELS.sonnet)).toBe(1536);
    expect(maxTokensFor("briefing", GRADY_MODELS.haiku)).toBe(1024);
    expect(maxTokensFor("classify", GRADY_MODELS.opus)).toBe(512);
    expect(maxTokensFor("compare_judge", GRADY_MODELS.haiku)).toBe(400);
    expect(maxTokensFor("chat", GRADY_MODELS.sonnet)).toBe(4096);
    expect(maxTokensFor("analysis", GRADY_MODELS.opus)).toBe(16000);
    expect(maxTokensFor("meeting_notes", GRADY_MODELS.sonnet)).toBe(4096);
  });

  it("bills a call through the Batches API at half the price", () => {
    const usage = { inputTokens: 10_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1_000 };
    expect(costUsd(GRADY_MODELS.sonnet, usage, { batch: true })).toBeCloseTo(
      costUsd(GRADY_MODELS.sonnet, usage) / 2,
      6,
    );
  });
});
