/**
 * Which jobs Grady does with a model, the models themselves and what a call
 * costs. Shared by the route and its tests; nothing here talks to the API.
 * Which model a job runs on is set in the administration (model-settings.ts);
 * the defaults are today's assignment (modelFor).
 */
import { AI_MODELS, MODEL_PRICES, type AiModel, type AiModelId, type AiModelKey } from "@/config/costs";

/** The API id of each model by its key (AI_MODELS in src/config/costs.ts). */
export const GRADY_MODELS = Object.fromEntries(AI_MODELS.map((model) => [model.key, model.id])) as {
  [K in AiModelKey]: Extract<AiModel, { key: K }>["id"];
};

export type GradyModel = AiModelId;
export type { AiModelKey };

export function aiModelByKey(key: string): AiModel | null {
  return AI_MODELS.find((model) => model.key === key) ?? null;
}

export function aiModelById(id: string): AiModel | null {
  return AI_MODELS.find((model) => model.id === id) ?? null;
}

/**
 * What a call is for; stored in ai_usage.purpose.
 * Routine work (classification, checks, short summaries) goes to Haiku by
 * default, conversation and reviews to Sonnet, large analyses to Opus.
 * `chat_route` is the one short Haiku call that picks the chat's model
 * when the rules alone cannot (chat-route.ts).
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
  "meeting_notes",
  "chat_route",
] as const;
export type GradyFeature = (typeof GRADY_FEATURES)[number];

/**
 * The default model of each job (today's assignment before 27.3): what runs
 * while the administration has set nothing, the price docs/funkce.md states,
 * and what the chat's automatic choice counts its savings against.
 */
const DEFAULTS: Record<GradyFeature, AiModelKey> = {
  classify: "haiku",
  check: "haiku",
  summary: "haiku",
  opportunity_scan: "haiku",
  chat_route: "haiku",
  chat: "sonnet",
  milestone_review: "sonnet",
  // Money rules for other people: read carefully, explained plainly.
  reward_setup: "sonnet",
  // A reply the user sends in their own name: needs a real conversation model.
  email_reply: "sonnet",
  // The test in the administration checks a conversation model, so a wrong model id shows there too.
  ping: "sonnet",
  // The morning brief picks the one thing worth noticing: worth a conversation model.
  briefing: "sonnet",
  // Branches for the user's own mind map: ideas worth a conversation model.
  note_map_suggest: "sonnet",
  // A meeting turned into changes of the user's own data (28.7): reads a long text carefully.
  meeting_notes: "sonnet",
  analysis: "opus",
};

export function defaultModelKey(feature: GradyFeature): AiModelKey {
  return DEFAULTS[feature];
}

/** The API id of the default model of a job. */
export function modelFor(feature: GradyFeature): GradyModel {
  return GRADY_MODELS[DEFAULTS[feature]];
}

/** The chat's routing call answers one word. */
export const ROUTE_MAX_TOKENS = 20;
/** The chat may write a little longer than a routine job, even on Haiku. */
const CHAT_MIN_TOKENS = 2048;

/**
 * Output cap per call: short answers stay short, analyses get room. By the
 * model it runs on (AI_MODELS.maxTokens); the chat gets at least
 * CHAT_MIN_TOKENS, the routing call one word.
 */
export function maxTokensFor(feature: GradyFeature, model: GradyModel = modelFor(feature)): number {
  if (feature === "chat_route") return ROUTE_MAX_TOKENS;
  const base = aiModelById(model)?.maxTokens ?? 4096;
  return feature === "chat" ? Math.max(base, CHAT_MIN_TOKENS) : base;
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
 * Price of one call in USD (AI_MODELS in src/config/costs.ts), rounded to
 * the column's six decimals. A long prompt on a model with a long-prompt
 * price pays that price for the whole request. `longPrompt` forces the
 * choice for summed tokens of many calls (the administration's estimates).
 */
export function costUsd(
  model: GradyModel,
  usage: TokenUsage,
  options: { longPrompt?: boolean } = {},
): number {
  const base = MODEL_PRICES[model];
  if (!base) return 0;
  const prompt = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const long = base.longPrompt;
  const useLong = options.longPrompt ?? (long ? prompt > long.aboveTokens : false);
  const price = long && useLong ? long : base;
  const micro =
    usage.inputTokens * price.input +
    usage.cacheReadTokens * price.cacheRead +
    usage.cacheWriteTokens * price.cacheWrite +
    usage.outputTokens * price.output;
  return Math.round(micro) / 1_000_000;
}
