// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

vi.mock("server-only", () => ({}));

const { COMPARE_CHECKS, comparePrompt, runCompareCell, sampleChars } = await import("./compare");
const { COMPARE_FEATURES, COMPARE_SAMPLES } = await import("../compare/samples");
const { runChecks } = await import("../compare/checks");

type StreamEvent = Anthropic.MessageStreamEvent;

/** Answers each call in turn: the compared job first, the grade second. */
function fakeModel(answers: string[]) {
  const calls: Anthropic.MessageStreamParams[] = [];
  const client = {
    messages: {
      stream: (params: Anthropic.MessageStreamParams) => {
        calls.push(params);
        const answer = answers[calls.length - 1] ?? "";
        return (async function* () {
          yield {
            type: "message_start",
            message: { usage: { input_tokens: 100, output_tokens: 1 } },
          } as unknown as StreamEvent;
          yield {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: answer },
          } as StreamEvent;
          yield {
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: 50 },
          } as unknown as StreamEvent;
        })();
      },
    },
  } as unknown as Pick<Anthropic, "messages">;
  return { client, calls };
}

describe("the prompts of the model comparison", () => {
  it("builds every sample of every job like the job itself", () => {
    for (const feature of COMPARE_FEATURES) {
      for (const sample of COMPARE_SAMPLES[feature] as readonly unknown[]) {
        const prompt = comparePrompt(feature, sample, null);
        expect(prompt.instructions.length).toBeGreaterThan(100);
        expect(prompt.messages).toHaveLength(1);
        expect(prompt.input.length).toBeGreaterThan(10);
      }
      expect(sampleChars(feature).every((chars) => chars > 100)).toBe(true);
    }
  });

  it("uses the job's own builders where the task is in the context", () => {
    const review = comparePrompt("milestone_review", COMPARE_SAMPLES.milestone_review[0], null);
    expect(review.context).toContain("<task>");
    expect(review.context).toContain("Rozjet marketing");
    const analysis = comparePrompt("analysis", COMPARE_SAMPLES.analysis[0], null);
    expect(analysis.context).toContain('<surveys total="6"');
    const week = comparePrompt("period_summary", COMPARE_SAMPLES.period_summary[0], "Buď stručný.");
    expect(week.instructions).toContain("new week");
    expect(week.instructions).toContain("Buď stručný.");
  });

  it("checks JSON jobs with their own parsers", () => {
    const ok = (feature: keyof typeof COMPARE_CHECKS, text: string) =>
      runChecks(COMPARE_CHECKS[feature], { text, stopReason: "end_turn", lang: "cs" }).every(
        (result) => result.ok,
      );
    expect(ok("classify", '{"isRequest": false, "title": "", "description": ""}')).toBe(true);
    expect(ok("classify", '{"isRequest": "maybe"}')).toBe(false);
    expect(ok("opportunity_scan", '{"suggestions": [], "completedTasks": []}')).toBe(true);
    expect(ok("note_map_suggest", '{"branches": [{"title": "Cena"}]}')).toBe(true);
    expect(ok("note_map_suggest", '{"branches": []}')).toBe(false);
  });
});

describe("one cell of the comparison", () => {
  it("runs the job's prompt on the picked model with the job's cap, then the grade", async () => {
    const { client, calls } = fakeModel([
      "Dnes nejdřív zavolej paní Lípové, pak schůzka v 10:00.",
      '{"score": 4, "reason": "Věcné, chybí včerejšek."}',
    ]);
    const log = vi.fn(async () => {});
    const result = await runCompareCell({
      client,
      userId: "u1",
      feature: "briefing",
      sample: COMPARE_SAMPLES.briefing[0],
      model: "opus",
      ownerInstructions: null,
      locale: "cs",
      log,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].model).toBe("claude-opus-5-5");
    // The brief's own cap, not Opus's 16,000.
    expect(calls[0].max_tokens).toBe(1536);
    expect(calls[1].model).toBe("claude-haiku-5-5");
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.map((call) => (call as unknown as [{ feature: string }])[0].feature)).toEqual([
      "model_compare",
      "compare_judge",
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.judge).toEqual({ score: 4, reason: "Věcné, chybí včerejšek." });
    expect(result.checks.every((check) => check.ok)).toBe(true);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it("keeps the answer when the grade fails", async () => {
    const { client } = fakeModel(['{"suggestions": [], "completedTasks": []}', "not json"]);
    const result = await runCompareCell({
      client,
      userId: "u1",
      feature: "opportunity_scan",
      sample: COMPARE_SAMPLES.opportunity_scan[2],
      model: "haiku",
      ownerInstructions: null,
      locale: "en",
      log: async () => {},
    });
    expect(result.ok && result.judge).toBeNull();
    expect(result.ok && result.checks.find((check) => check.key === "json")?.ok).toBe(true);
  });
});
