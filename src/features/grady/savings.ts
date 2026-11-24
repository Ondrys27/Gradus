/**
 * "Where to save" in AI and Grady → Models (step 28.9). Pure: from the last
 * 30 days of ai_usage (model-usage.ts) and the signs of quality by job
 * (admin_ai_quality_signals: re-asks, failed calls, thumbs, undone changes)
 * it recommends, per job, a cheaper model where the answers hold up and
 * there is money to save, a better one where people keep asking again or
 * the answers fail, and the chat's automatic choice where the chat is fixed
 * on a bigger model. One click in the administration applies a
 * recommendation (the usual confirmation and audit).
 *
 * The amounts price the same tokens on the other model (like the estimates
 * of the table), so they are a guide, not a promise.
 */
import { AI_MODELS, type AiModelKey } from "@/config/costs";
import {
  allowedChoices,
  AUTO,
  FEATURE_MODELS,
  SETTABLE_FEATURES,
  type FeatureChoice,
  type GradyModelSettings,
  type SettableFeature,
} from "./model-settings";
import type { ModelUsageSummary } from "./model-usage";
import { aiModelByKey } from "./models";

export type JobSignals = {
  /** Calls of the job (the chat: every round). */
  calls: number;
  /** What people asked for (the chat: user messages; other jobs: calls). */
  asks: number;
  /** Asked again soon after an answer (the chat: a rephrased question). */
  repeats: number;
  /** Calls that failed (an error or an empty answer). */
  failures: number;
  ratingsUp: number;
  ratingsDown: number;
  /** Grady's changes in the app (chat only) and how many were undone. */
  actions: number;
  actionsUndone: number;
};

/** By job (ai_usage.purpose). */
export type QualitySignals = Record<string, JobSignals>;

/** Too few calls say nothing: no recommendation below this in 30 days. */
export const MIN_CALLS = 20;
/** A cheaper model is worth the change from this much a month… */
export const MIN_SAVING_USD = 0.5;
/** …and this share of what the job costs now. */
export const MIN_SAVING_SHARE = 0.2;

/** Signs of answers that did not help: any of these asks for a better model. */
export const LOW_QUALITY = {
  repeatShare: 0.2,
  downShare: 0.3,
  minRatings: 5,
  failShare: 0.1,
  minFailures: 5,
  undoShare: 0.2,
  minActions: 5,
} as const;

/** Signs that the answers hold up: all of these allow a cheaper model. */
export const HEALTHY = {
  repeatShare: 0.1,
  downShare: 0.15,
  failShare: 0.05,
  undoShare: 0.1,
} as const;

export type ReasonKey =
  | "repeats"
  | "ratingsDown"
  | "failures"
  | "undone"
  | "healthy"
  | "autoChat"
  | "autoChatQuality";

export type ModelRecommendation = {
  feature: SettableFeature;
  kind: "cheaper" | "better" | "auto" | "fixed";
  from: FeatureChoice;
  to: FeatureChoice;
  /** Positive: saved a month; negative: what it costs more. Null when it cannot be estimated. */
  monthlyUsd: number | null;
  reasons: { key: ReasonKey; share: number | null }[];
};

const share = (part: number, whole: number) => (whole > 0 ? part / whole : 0);

export type JobQuality = {
  repeatShare: number;
  downShare: number | null;
  failShare: number;
  undoShare: number | null;
};

export function jobQuality(signals: JobSignals | undefined, interactive: boolean): JobQuality {
  const s = signals ?? {
    calls: 0,
    asks: 0,
    repeats: 0,
    failures: 0,
    ratingsUp: 0,
    ratingsDown: 0,
    actions: 0,
    actionsUndone: 0,
  };
  const ratings = s.ratingsUp + s.ratingsDown;
  return {
    // Jobs nobody asks for by hand (summaries, the watch) have no re-asks.
    repeatShare: interactive ? share(s.repeats, s.asks) : 0,
    downShare: ratings >= LOW_QUALITY.minRatings ? share(s.ratingsDown, ratings) : null,
    failShare: s.failures >= LOW_QUALITY.minFailures ? share(s.failures, s.calls) : 0,
    undoShare: s.actions >= LOW_QUALITY.minActions ? share(s.actionsUndone, s.actions) : null,
  };
}

function lowQualityReasons(q: JobQuality): ModelRecommendation["reasons"] {
  const reasons: ModelRecommendation["reasons"] = [];
  if (q.repeatShare >= LOW_QUALITY.repeatShare) reasons.push({ key: "repeats", share: q.repeatShare });
  if (q.downShare !== null && q.downShare >= LOW_QUALITY.downShare) {
    reasons.push({ key: "ratingsDown", share: q.downShare });
  }
  if (q.failShare >= LOW_QUALITY.failShare) reasons.push({ key: "failures", share: q.failShare });
  if (q.undoShare !== null && q.undoShare >= LOW_QUALITY.undoShare) {
    reasons.push({ key: "undone", share: q.undoShare });
  }
  return reasons;
}

function healthy(q: JobQuality): boolean {
  return (
    q.repeatShare < HEALTHY.repeatShare &&
    (q.downShare === null || q.downShare < HEALTHY.downShare) &&
    q.failShare < HEALTHY.failShare &&
    (q.undoShare === null || q.undoShare < HEALTHY.undoShare)
  );
}

const rankOf = (key: AiModelKey) => aiModelByKey(key)?.rank ?? 0;

/** The allowed model one step below or above, or null. */
function neighbour(feature: SettableFeature, key: AiModelKey, step: -1 | 1): AiModelKey | null {
  const allowed = allowedChoices(feature).filter((choice): choice is AiModelKey => choice !== AUTO);
  const sorted = AI_MODELS.filter((model) => allowed.includes(model.key)).sort(
    (a, b) => a.rank - b.rank,
  );
  const index = sorted.findIndex((model) => model.key === key);
  const next = sorted[index + step];
  return index >= 0 && next ? next.key : null;
}

/** The recommendations, the biggest money first; at most one per job. */
export function recommendModels(
  usage: ModelUsageSummary,
  signals: QualitySignals,
  settings: GradyModelSettings,
): ModelRecommendation[] {
  const out: ModelRecommendation[] = [];
  for (const feature of SETTABLE_FEATURES) {
    const spec = FEATURE_MODELS[feature];
    const row = usage.features[feature];
    if (!row || row.calls < MIN_CALLS) continue;
    const choice = settings.features[feature];
    const quality = jobQuality(signals[feature], !!spec.interactive);
    const low = lowQualityReasons(quality);

    if (choice === AUTO) {
      // The chat picks per message; when its answers do not hold up, a fixed Sonnet.
      if (low.length) {
        out.push({
          feature,
          kind: "fixed",
          from: AUTO,
          to: "sonnet",
          monthlyUsd: -(row.estimates.sonnet - row.costUsd),
          reasons: [...low, { key: "autoChatQuality", share: null }],
        });
      }
      continue;
    }

    if (low.length) {
      const better = neighbour(feature, choice, 1);
      if (better) {
        out.push({
          feature,
          kind: "better",
          from: choice,
          to: better,
          monthlyUsd: -(row.estimates[better] - row.estimates[choice]),
          reasons: low,
        });
      }
      continue;
    }
    if (!healthy(quality)) continue;

    // The chat fixed on a bigger model: the automatic choice saves what Haiku can answer.
    if (spec.auto && rankOf(choice) > rankOf("haiku")) {
      const ratio =
        usage.routing.baselineUsd > 0
          ? Math.max(0, usage.routing.savedUsd / usage.routing.baselineUsd)
          : null;
      out.push({
        feature,
        kind: "auto",
        from: choice,
        to: AUTO,
        monthlyUsd: ratio === null ? null : row.estimates[choice] * ratio,
        reasons: [
          { key: "healthy", share: null },
          { key: "autoChat", share: null },
        ],
      });
      continue;
    }

    const cheaper = neighbour(feature, choice, -1);
    if (!cheaper) continue;
    const saved = row.estimates[choice] - row.estimates[cheaper];
    if (saved < MIN_SAVING_USD || share(saved, row.estimates[choice]) < MIN_SAVING_SHARE) continue;
    out.push({
      feature,
      kind: "cheaper",
      from: choice,
      to: cheaper,
      monthlyUsd: saved,
      reasons: [{ key: "healthy", share: null }],
    });
  }
  return out.sort((a, b) => Math.abs(b.monthlyUsd ?? 0) - Math.abs(a.monthlyUsd ?? 0));
}

/** The settings with the recommendations applied (the form saves them with the usual confirmation). */
export function applyRecommendations<T extends { features: Record<SettableFeature, FeatureChoice> }>(
  form: T,
  recommendations: readonly Pick<ModelRecommendation, "feature" | "to">[],
): T {
  const features = { ...form.features };
  for (const item of recommendations) {
    if (allowedChoices(item.feature).includes(item.to)) features[item.feature] = item.to;
  }
  return { ...form, features };
}
