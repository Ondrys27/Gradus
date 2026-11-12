/**
 * Which model does which job, and what a call costs. Shared by the route and
 * its tests; nothing here talks to the API.
 */
import { MODEL_PRICES } from "@/config/costs";

/** The newest Haiku, Sonnet and Opus (checked against the models overview on 2026-10-12). */
export const GRADY_MODELS = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
} as const;

export type GradyModel = (typeof GRADY_MODELS)[keyof typeof GRADY_MODELS];

/**
 * What a call is for; stored in ai_usage.purpose.
 * Routine work (classification, checks, short summaries) goes to Haiku,
 * conversation and reviews to Sonnet, large analyses to Opus.
 */
export const GRADY_FEATURES = [
  "chat",
  "milestone_review",
  "classify",
  "check",
  "summary",
  "opportunity_scan",
  "analysis",
  "reward_setup",
  "email_reply",
  "ping",
  "briefing",
  "note_map_suggest",
] as const;
export type GradyFeature = (typeof GRADY_FEATURES)[number];

const ROUTES: Record<GradyFeature, GradyModel> = {
  classify: GRADY_MODELS.haiku,
  check: GRADY_MODELS.haiku,
  summary: GRADY_MODELS.haiku,
  opportunity_scan: GRADY_MODELS.haiku,
  chat: GRADY_MODELS.sonnet,
  milestone_review: GRADY_MODELS.sonnet,
  // Money rules for other people: read carefully, explained plainly.
  reward_setup: GRADY_MODELS.sonnet,
  // A reply the user sends in their own name: needs a real conversation model.
  email_reply: GRADY_MODELS.sonnet,
  // The test in Settings checks the chat's own model, so a wrong model id shows there too.
  ping: GRADY_MODELS.sonnet,
  // The morning brief picks the one thing worth noticing: worth a conversation model.
  briefing: GRADY_MODELS.sonnet,
  // Branches for the user's own mind map: ideas worth a conversation model.
  note_map_suggest: GRADY_MODELS.sonnet,
  analysis: GRADY_MODELS.opus,
};

export function modelFor(feature: GradyFeature): GradyModel {
  return ROUTES[feature];
}

/** Output cap per job: short answers stay short, analyses get room. */
export function maxTokensFor(feature: GradyFeature): number {
  switch (ROUTES[feature]) {
    case GRADY_MODELS.haiku:
      return 1024;
    case GRADY_MODELS.sonnet:
      return 4096;
    default:
      return 16000;
  }
}

export type TokenUsage = {
  /** Input tokens that were neither read from nor written to the cache. */
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
};

export const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
};

/**
 * Price of one call in USD (MODEL_PRICES in src/config/costs.ts), rounded to
 * the column's six decimals. A long prompt on a model with a long-prompt
 * price pays that price for the whole request.
 */
export function costUsd(model: GradyModel, usage: TokenUsage): number {
  const base = MODEL_PRICES[model];
  const prompt = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const long = "longPrompt" in base ? base.longPrompt : undefined;
  const price = long && prompt > long.aboveTokens ? long : base;
  const micro =
    usage.inputTokens * price.input +
    usage.cacheReadTokens * price.cacheRead +
    usage.cacheWriteTokens * price.cacheWrite +
    usage.outputTokens * price.output;
  return Math.round(micro) / 1_000_000;
}
