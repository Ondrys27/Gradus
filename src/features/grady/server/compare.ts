import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { AiModelKey } from "@/config/costs";
import { meetingAnswerSchema } from "@/features/meeting-notes/logic";
import { atMostLines, hasThreePoints, runChecks, type CheckResult, type CheckSpec } from "../compare/checks";
import { judgeContext, JUDGE_INSTRUCTIONS, parseJudge, type JudgeVerdict } from "../compare/judge";
import {
  COMPARE_SAMPLES,
  type CompareFeature,
  type MilestoneSample,
  type PeriodSample,
  type PromptSample,
  type SurveySample,
} from "../compare/samples";
import { parseModelJson } from "../model-json";
import { costUsd, type GradyModel, type TokenUsage } from "../models";
import { GRADY_PERSONA, withOwnerInstructions } from "../prompt";
import type { ChatErrorCode } from "../protocol";
import {
  BRIEFING_INSTRUCTIONS,
  BRIEFING_MAX,
  MONTH_SUMMARY_INSTRUCTIONS,
  PERIOD_SUMMARY_MAX,
  WEEK_SUMMARY_INSTRUCTIONS,
} from "./briefing";
import { EMAIL_REPLY_INSTRUCTIONS, MAX_REPLY_LENGTH } from "./email-reply";
import { classificationSchema, FEATURE_CLASSIFIER_INSTRUCTIONS } from "./feature-requests";
import { MEETING_NOTES_INSTRUCTIONS } from "./meeting-notes";
import { MAX_FEEDBACK_LENGTH, milestoneReviewContext } from "./milestone-review";
import { streamModel, type ModelCall, type ModelClient } from "./model";
import { NOTE_MAP_SUGGEST_INSTRUCTIONS, suggestAnswerSchema } from "./note-map-suggest";
import { MAX_ANALYSIS_LENGTH, salesAnalysisContext } from "./sales-analysis";
import { parseWatchAnswer, WATCH_INSTRUCTIONS } from "./watch";

/**
 * The administration's model comparison (step 28.9): one job's prompt on one
 * sample, on the model the owner picked (job model_compare), its format
 * checks, then the short grade (job compare_judge). Both calls go through
 * the budget guard and into ai_usage like every call; nothing else is saved.
 */

type Prompt = {
  instructions: string;
  context: string;
  messages: Anthropic.MessageParam[];
  /** What the grader reads as the job's input. */
  input: string;
  lang: "cs" | "en";
};

const fromPrompt = (instructions: string, sample: PromptSample): Prompt => ({
  instructions,
  context: sample.context,
  messages: [{ role: "user", content: sample.message }],
  input: `${sample.context}\n\n${sample.message}`.trim(),
  lang: sample.lang,
});

const jsonWith =
  <T>(parse: (text: string) => T | null) =>
  (text: string) =>
    parse(text) !== null;

/** The prompt each job builds from its sample, exactly as the job itself does. */
export function comparePrompt(
  feature: CompareFeature,
  sample: unknown,
  ownerInstructions: string | null,
): Prompt {
  switch (feature) {
    case "chat":
      return fromPrompt(
        withOwnerInstructions(GRADY_PERSONA, ownerInstructions),
        sample as PromptSample,
      );
    case "milestone_review": {
      const s = sample as MilestoneSample;
      const context = milestoneReviewContext(s.milestone, s.today, s.locale);
      return {
        instructions: GRADY_PERSONA,
        context,
        messages: [{ role: "user", content: "Review my new milestone." }],
        input: context,
        lang: s.lang,
      };
    }
    case "analysis": {
      const s = sample as SurveySample;
      const context = salesAnalysisContext(s.surveys, s.locale);
      return {
        instructions: GRADY_PERSONA,
        context,
        messages: [{ role: "user", content: "Analyse my sales meetings." }],
        input: context,
        lang: s.lang,
      };
    }
    case "classify":
      return fromPrompt(FEATURE_CLASSIFIER_INSTRUCTIONS, sample as PromptSample);
    case "opportunity_scan":
      return fromPrompt(WATCH_INSTRUCTIONS, sample as PromptSample);
    case "email_reply":
      return fromPrompt(EMAIL_REPLY_INSTRUCTIONS, sample as PromptSample);
    case "briefing":
      return fromPrompt(
        withOwnerInstructions(BRIEFING_INSTRUCTIONS, ownerInstructions),
        sample as PromptSample,
      );
    case "period_summary": {
      const s = sample as PeriodSample;
      const base = s.period === "week" ? WEEK_SUMMARY_INSTRUCTIONS : MONTH_SUMMARY_INSTRUCTIONS;
      return fromPrompt(withOwnerInstructions(base, ownerInstructions), s);
    }
    case "note_map_suggest":
      return fromPrompt(NOTE_MAP_SUGGEST_INSTRUCTIONS, sample as PromptSample);
    case "meeting_notes":
      return fromPrompt(MEETING_NOTES_INSTRUCTIONS, sample as PromptSample);
  }
}

/** What every job's answer is checked for (compare/checks.ts). */
export const COMPARE_CHECKS: Record<CompareFeature, CheckSpec> = {
  chat: { language: true },
  milestone_review: { maxChars: MAX_FEEDBACK_LENGTH, plain: true, language: true },
  classify: { json: jsonWith((text) => parseModelJson(text, classificationSchema)) },
  opportunity_scan: { json: jsonWith(parseWatchAnswer) },
  analysis: { maxChars: MAX_ANALYSIS_LENGTH, plain: true, language: true },
  email_reply: { maxChars: MAX_REPLY_LENGTH, plain: true, language: true },
  briefing: { maxChars: BRIEFING_MAX, plain: true, language: true, shape: atMostLines(3) },
  period_summary: {
    maxChars: PERIOD_SUMMARY_MAX,
    plain: true,
    language: true,
    shape: hasThreePoints,
  },
  note_map_suggest: { json: jsonWith((text) => parseModelJson(text, suggestAnswerSchema)) },
  meeting_notes: { json: jsonWith((text) => parseModelJson(text, meetingAnswerSchema)) },
};

/** The characters of every sample's prompt of a job, for the estimate before a run. */
export function sampleChars(feature: CompareFeature): number[] {
  return (COMPARE_SAMPLES[feature] as readonly unknown[]).map((sample) => {
    const prompt = comparePrompt(feature, sample, null);
    const messages = prompt.messages
      .map((message) => (typeof message.content === "string" ? message.content : ""))
      .join("");
    return prompt.instructions.length + prompt.context.length + messages.length;
  });
}

export type CompareCellResult =
  | {
      ok: true;
      text: string;
      model: GradyModel;
      durationMs: number;
      costUsd: number;
      tokens: TokenUsage;
      checks: CheckResult[];
      judge: JudgeVerdict | null;
      judgeCostUsd: number;
    }
  | { ok: false; code: ChatErrorCode; durationMs: number; costUsd: number };

export async function runCompareCell(args: {
  client: ModelClient;
  userId: string;
  feature: CompareFeature;
  sample: unknown;
  model: AiModelKey;
  ownerInstructions: string | null;
  /** The administration's language, for the grader's sentence. */
  locale: string;
  log: ModelCall["log"];
}): Promise<CompareCellResult> {
  const prompt = comparePrompt(args.feature, args.sample, args.ownerInstructions);
  const started = Date.now();
  const result = await streamModel({
    client: args.client,
    userId: args.userId,
    feature: "model_compare",
    explicitModel: args.model,
    as: args.feature,
    instructions: prompt.instructions,
    context: prompt.context,
    messages: prompt.messages,
    log: args.log,
  });
  const durationMs = Date.now() - started;
  const spent = costUsd(result.model, result.tokens);
  if (!result.ok) return { ok: false, code: result.code, durationMs, costUsd: spent };

  const checks = runChecks(COMPARE_CHECKS[args.feature], {
    text: result.text,
    stopReason: result.stopReason,
    lang: prompt.lang,
  });

  // The grade is a help, not a condition: a failed grade leaves the answer as it is.
  const graded = await streamModel({
    client: args.client,
    userId: args.userId,
    feature: "compare_judge",
    instructions: JUDGE_INSTRUCTIONS,
    context: judgeContext({
      feature: args.feature,
      input: prompt.input,
      answer: result.text,
      locale: args.locale,
    }),
    messages: [{ role: "user", content: "Grade the answer." }],
    log: args.log,
  });
  return {
    ok: true,
    text: result.text,
    model: result.model,
    durationMs,
    costUsd: spent,
    tokens: result.tokens,
    checks,
    judge: graded.ok ? parseJudge(graded.text) : null,
    judgeCostUsd: costUsd(graded.model, graded.tokens),
  };
}
