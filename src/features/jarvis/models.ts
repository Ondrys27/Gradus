/**
 * Which model does which job, and what a call costs. Shared by the route and
 * its tests; nothing here talks to the API.
 */

export const JARVIS_MODELS = {
  haiku: "claude-haiku-4-5",
  sonnet: "claude-sonnet-5",
  opus: "claude-opus-5",
} as const;

export type JarvisModel = (typeof JARVIS_MODELS)[keyof typeof JARVIS_MODELS];

/**
 * What a call is for; stored in ai_usage.purpose.
 * Routine work (classification, checks, short summaries) goes to Haiku,
 * conversation and reviews to Sonnet, large analyses to Opus.
 */
export const JARVIS_FEATURES = [
  "chat",
  "milestone_review",
  "classify",
  "check",
  "summary",
  "opportunity_scan",
  "analysis",
  "reward_setup",
  "email_reply",
] as const;
export type JarvisFeature = (typeof JARVIS_FEATURES)[number];

const ROUTES: Record<JarvisFeature, JarvisModel> = {
  classify: JARVIS_MODELS.haiku,
  check: JARVIS_MODELS.haiku,
  summary: JARVIS_MODELS.haiku,
  opportunity_scan: JARVIS_MODELS.haiku,
  chat: JARVIS_MODELS.sonnet,
  milestone_review: JARVIS_MODELS.sonnet,
  // Money rules for other people: read carefully, explained plainly.
  reward_setup: JARVIS_MODELS.sonnet,
  // A reply the user sends in their own name: needs a real conversation model.
  email_reply: JARVIS_MODELS.sonnet,
  analysis: JARVIS_MODELS.opus,
};

export function modelFor(feature: JarvisFeature): JarvisModel {
  return ROUTES[feature];
}

/** Output cap per job: short answers stay short, analyses get room. */
export function maxTokensFor(feature: JarvisFeature): number {
  switch (ROUTES[feature]) {
    case JARVIS_MODELS.haiku:
      return 1024;
    case JARVIS_MODELS.sonnet:
      return 4096;
    default:
      return 16000;
  }
}

/** USD per million tokens, first-party API list prices. */
const PRICES: Record<JarvisModel, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-5": { input: 5, output: 25 },
};

/** Reading from the cache costs a tenth of input, writing a 5-minute entry a quarter more. */
const CACHE_READ_FACTOR = 0.1;
const CACHE_WRITE_FACTOR = 1.25;

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

/** Price of one call in USD, rounded to the column's six decimals. */
export function costUsd(model: JarvisModel, usage: TokenUsage): number {
  const price = PRICES[model];
  const micro =
    usage.inputTokens * price.input +
    usage.cacheReadTokens * price.input * CACHE_READ_FACTOR +
    usage.cacheWriteTokens * price.input * CACHE_WRITE_FACTOR +
    usage.outputTokens * price.output;
  return Math.round(micro) / 1_000_000;
}
