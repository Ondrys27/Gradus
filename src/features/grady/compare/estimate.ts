/**
 * What a model comparison will cost before it runs (step 28.9). Pure and on
 * the safe side: every input token at the full price (no cache), the output
 * the job usually writes (its average over 30 days from ai_usage when there
 * is one, else TYPICAL_OUTPUT), more for models that think before they
 * answer, plus one grade per answer on the grader's model.
 */
import { AI_MODELS, type AiModelKey } from "@/config/costs";
import { costUsd, GRADY_MODELS, maxTokensFor, type GradyFeature } from "../models";
import type { CompareFeature } from "./samples";

/**
 * Characters per token, on the safe side: the count_tokens endpoint gave
 * 2.15 for the Czech chat context of scripts/ai-savings.ts (Sonnet 5.5),
 * English prompts have more characters per token.
 */
export const CHARS_PER_TOKEN = 2.1;

export function tokensOf(chars: number): number {
  return Math.ceil(Math.max(0, chars) / CHARS_PER_TOKEN);
}

/** Output tokens one answer of a job usually has (docs/funkce.md), without thinking. */
export const TYPICAL_OUTPUT: Record<CompareFeature, number> = {
  chat: 450,
  milestone_review: 350,
  classify: 60,
  opportunity_scan: 300,
  analysis: 1200,
  email_reply: 400,
  briefing: 200,
  period_summary: 450,
  note_map_suggest: 300,
  meeting_notes: 1200,
};

/** A model that thinks first writes this much more (low effort); the analysis thinks hard. */
const THINKING_EXTRA = 0.5;
const ANALYSIS_THINKING_EXTRA = 1.5;

/** One grade: the criteria, the sample and the answer in, a score and a sentence out. */
const JUDGE_FIXED_CHARS = 1_600;
const JUDGE_OUTPUT = 80;
const JUDGE_INPUT_MAX_CHARS = 6_000;

export type CompareEstimateInput = {
  feature: CompareFeature;
  models: readonly AiModelKey[];
  /** Characters of each sample's prompt: instructions, context and message. */
  sampleChars: readonly number[];
  /** Average output tokens of the job over 30 days, or null without calls. */
  observedOutput: number | null;
  /** The grader's model; null = no grades. */
  judge: AiModelKey | null;
};

export type CompareEstimate = {
  /** By model: all its samples. */
  perModel: Record<string, number>;
  judgeUsd: number;
  totalUsd: number;
  calls: number;
};

function outputTokens(feature: CompareFeature, model: AiModelKey, observed: number | null): number {
  const spec = AI_MODELS.find((entry) => entry.key === model);
  const base = observed ?? TYPICAL_OUTPUT[feature];
  const extra = spec?.thinkingOff
    ? 0
    : feature === "analysis"
      ? ANALYSIS_THINKING_EXTRA
      : THINKING_EXTRA;
  const cap = maxTokensFor(feature as GradyFeature, GRADY_MODELS[model]);
  return Math.min(cap, Math.ceil(base * (1 + extra)));
}

export function estimateCompare(input: CompareEstimateInput): CompareEstimate {
  const perModel: Record<string, number> = {};
  let judgeUsd = 0;
  let calls = 0;
  for (const model of input.models) {
    const out = outputTokens(input.feature, model, input.observedOutput);
    let usd = 0;
    for (const chars of input.sampleChars) {
      usd += costUsd(GRADY_MODELS[model], {
        inputTokens: tokensOf(chars),
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: out,
      });
      calls += 1;
      if (input.judge) {
        const judgeIn =
          JUDGE_FIXED_CHARS + Math.min(chars, JUDGE_INPUT_MAX_CHARS) + out * CHARS_PER_TOKEN;
        judgeUsd += costUsd(GRADY_MODELS[input.judge], {
          inputTokens: tokensOf(judgeIn),
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: JUDGE_OUTPUT,
        });
        calls += 1;
      }
    }
    perModel[model] = usd;
  }
  const totalUsd = Object.values(perModel).reduce((sum, usd) => sum + usd, 0) + judgeUsd;
  return { perModel, judgeUsd, totalUsd, calls };
}

/** At most this many models in one comparison (a column each). */
export const COMPARE_MAX_MODELS = 4;
