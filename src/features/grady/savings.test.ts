import { describe, expect, it } from "vitest";
import { DEFAULT_GRADY_MODELS, type GradyModelSettings } from "./model-settings";
import { summarizeModelUsage, type ModelUsageRow } from "./model-usage";
import { applyRecommendations, jobQuality, recommendModels, type JobSignals } from "./savings";

const tokens = (input: number, output: number) => ({
  inputTokens: input,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: output,
});

/** 30 days of one job on one model: calls and their tokens. */
function row(purpose: string, model: string, calls: number, input: number, output: number): ModelUsageRow {
  return {
    purpose,
    model,
    routedFrom: null,
    longPrompt: false,
    calls,
    tokens: tokens(input, output),
    costUsd: 0,
  };
}

const signals = (over: Partial<JobSignals> = {}): JobSignals => ({
  calls: 400,
  asks: 400,
  repeats: 4,
  failures: 0,
  ratingsUp: 0,
  ratingsDown: 0,
  actions: 0,
  actionsUndone: 0,
  ...over,
});

const settings = (features: Partial<GradyModelSettings["features"]>): GradyModelSettings => ({
  ...DEFAULT_GRADY_MODELS,
  features: { ...DEFAULT_GRADY_MODELS.features, ...features },
  source: "database",
});

describe("where to save", () => {
  it("recommends the cheaper model where the answers hold up and the saving is worth it", () => {
    const usage = summarizeModelUsage([
      row("email_reply", "claude-sonnet-5-5", 400, 700_000, 160_000),
    ]);
    const [first] = recommendModels(usage, { email_reply: signals() }, DEFAULT_GRADY_MODELS);
    expect(first).toMatchObject({ feature: "email_reply", kind: "cheaper", from: "sonnet", to: "haiku" });
    // 0.7 M input + 0.16 M output: Sonnet 3.00 USD, Haiku 0.15 USD.
    expect(first.monthlyUsd).toBeCloseTo(3.0 - 0.15, 6);
  });

  it("recommends a better model when people keep asking again", () => {
    const usage = summarizeModelUsage([row("email_reply", "claude-haiku-5-5", 100, 170_000, 40_000)]);
    const [first] = recommendModels(
      usage,
      { email_reply: signals({ asks: 100, repeats: 30 }) },
      settings({ email_reply: "haiku" }),
    );
    expect(first).toMatchObject({ kind: "better", from: "haiku", to: "sonnet" });
    expect(first.monthlyUsd).toBeLessThan(0);
    expect(first.reasons[0]).toEqual({ key: "repeats", share: 0.3 });
  });

  it("never goes below a job's minimum and says nothing with too few calls or little to save", () => {
    const usage = summarizeModelUsage([
      row("meeting_notes", "claude-sonnet-5-5", 200, 2_000_000, 200_000),
      row("milestone_review", "claude-sonnet-5-5", 5, 10_000, 2_000),
      row("note_map_suggest", "claude-sonnet-5-5", 40, 50_000, 10_000),
    ]);
    const list = recommendModels(
      usage,
      { meeting_notes: signals(), milestone_review: signals(), note_map_suggest: signals() },
      DEFAULT_GRADY_MODELS,
    );
    expect(list).toEqual([]);
  });

  it("does not count re-asks for jobs nobody asks for by hand", () => {
    const quality = jobQuality(signals({ repeats: 300 }), false);
    expect(quality.repeatShare).toBe(0);
    const usage = summarizeModelUsage([row("briefing", "claude-sonnet-5-5", 900, 1_200_000, 180_000)]);
    const [first] = recommendModels(
      usage,
      { briefing: signals({ calls: 900, asks: 900, repeats: 400 }) },
      DEFAULT_GRADY_MODELS,
    );
    expect(first).toMatchObject({ feature: "briefing", kind: "cheaper", to: "haiku" });
  });

  it("puts a fixed chat on the automatic choice, and an auto chat with thumbs down on Sonnet", () => {
    const usage = summarizeModelUsage([row("chat", "claude-sonnet-5-5", 500, 2_000_000, 200_000)]);
    const [auto] = recommendModels(usage, { chat: signals() }, settings({ chat: "sonnet" }));
    expect(auto).toMatchObject({ kind: "auto", from: "sonnet", to: "auto", monthlyUsd: null });

    const [fixed] = recommendModels(
      usage,
      { chat: signals({ ratingsUp: 4, ratingsDown: 6 }) },
      DEFAULT_GRADY_MODELS,
    );
    expect(fixed).toMatchObject({ kind: "fixed", from: "auto", to: "sonnet" });
    expect(fixed.reasons.map((reason) => reason.key)).toContain("ratingsDown");
  });

  it("applies recommendations to the form, only allowed models", () => {
    const form = { features: { ...DEFAULT_GRADY_MODELS.features }, economy: false, chatLarge: null };
    const next = applyRecommendations(form, [
      { feature: "email_reply", to: "haiku" },
      { feature: "meeting_notes", to: "haiku" },
    ]);
    expect(next.features.email_reply).toBe("haiku");
    expect(next.features.meeting_notes).toBe("sonnet");
  });
});
