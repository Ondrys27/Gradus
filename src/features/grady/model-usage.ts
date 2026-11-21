/**
 * What each of Grady's jobs cost over a period and what it would have cost on
 * another model (Administration → AI and Grady → Models, step 27.3). Pure:
 * the rows are admin_ai_model_usage() (calls and tokens by job, model, the
 * model it was routed from and long prompt), the prices AI_MODELS. The
 * estimates price the same tokens on another model: a model writes answers
 * of its own length, so they are a guide, not a promise.
 */
import { AI_MODELS, type AiModelKey } from "@/config/costs";
import { costUsd, GRADY_FEATURES, type GradyFeature, type GradyModel, type TokenUsage } from "./models";

export type ModelUsageRow = {
  purpose: string;
  model: string;
  routedFrom: string | null;
  /** The prompt was over 100,000 tokens (Haiku's long-prompt price, per request). */
  longPrompt: boolean;
  calls: number;
  tokens: TokenUsage;
  costUsd: number;
};

export type FeatureUsage = {
  feature: GradyFeature;
  calls: number;
  costUsd: number;
  /** The same tokens priced on each model. */
  estimates: Record<AiModelKey, number>;
};

export type RoutingSavings = {
  /** Calls whose model the automatic choice or economy mode picked. */
  calls: number;
  /** What they cost. */
  costUsd: number;
  /** What they would have cost on the model they were routed from. */
  baselineUsd: number;
  /** The routing calls themselves (chat_route). */
  routeCostUsd: number;
  /** baseline − cost − routing calls; negative when the choice cost more than it saved. */
  savedUsd: number;
};

export type ModelUsageSummary = {
  features: Record<GradyFeature, FeatureUsage>;
  total: { calls: number; costUsd: number; estimates: Record<AiModelKey, number> };
  routing: RoutingSavings;
};

const isFeature = (value: string): value is GradyFeature =>
  (GRADY_FEATURES as readonly string[]).includes(value);

const isModel = (value: string | null): value is GradyModel =>
  !!value && AI_MODELS.some((model) => model.id === value);

function zeroEstimates(): Record<AiModelKey, number> {
  return Object.fromEntries(AI_MODELS.map((model) => [model.key, 0])) as Record<AiModelKey, number>;
}

export function summarizeModelUsage(rows: readonly ModelUsageRow[]): ModelUsageSummary {
  const features = Object.fromEntries(
    GRADY_FEATURES.map((feature) => [
      feature,
      { feature, calls: 0, costUsd: 0, estimates: zeroEstimates() },
    ]),
  ) as Record<GradyFeature, FeatureUsage>;
  const total = { calls: 0, costUsd: 0, estimates: zeroEstimates() };
  const routing: RoutingSavings = {
    calls: 0,
    costUsd: 0,
    baselineUsd: 0,
    routeCostUsd: 0,
    savedUsd: 0,
  };

  for (const row of rows) {
    total.calls += row.calls;
    total.costUsd += row.costUsd;
    const priced = AI_MODELS.map(
      (model) => [model.key, costUsd(model.id, row.tokens, { longPrompt: row.longPrompt })] as const,
    );
    for (const [key, usd] of priced) total.estimates[key] += usd;

    if (row.purpose === "chat_route") routing.routeCostUsd += row.costUsd;
    if (isModel(row.routedFrom)) {
      routing.calls += row.calls;
      routing.costUsd += row.costUsd;
      routing.baselineUsd += costUsd(row.routedFrom, row.tokens, { longPrompt: row.longPrompt });
    }

    if (!isFeature(row.purpose)) continue;
    const usage = features[row.purpose];
    usage.calls += row.calls;
    usage.costUsd += row.costUsd;
    for (const [key, usd] of priced) usage.estimates[key] += usd;
  }
  routing.savedUsd = routing.baselineUsd - routing.costUsd - routing.routeCostUsd;
  return { features, total, routing };
}

/** The average price of 1,000 calls, or null without calls (a single call is a fraction of a cent). */
export function perThousandCalls(usage: Pick<FeatureUsage, "calls" | "costUsd">): number | null {
  return usage.calls > 0 ? (usage.costUsd / usage.calls) * 1000 : null;
}
