import "server-only";
import type { AiModelKey } from "@/config/costs";
import { COMPARE_FEATURES, COMPARE_SAMPLES, type CompareFeature } from "@/features/grady/compare/samples";
import { chooseModel, type GradyModelSettings } from "@/features/grady/model-settings";
import type { ModelUsageSummary } from "@/features/grady/model-usage";
import { sampleChars } from "@/features/grady/server/compare";

/**
 * What the "Compare models" dialog needs before a run (step 28.9): the
 * samples of every job (id, short name, language; the texts stay on the
 * server until a run), their prompt sizes and the job's average output over
 * 30 days for the estimate, and the grader's model. Only for whoever may
 * run a comparison.
 */
export type CompareCatalog = {
  judge: AiModelKey;
  features: Partial<
    Record<
      CompareFeature,
      {
        samples: { id: string; label: string; lang: "cs" | "en" }[];
        sampleChars: number[];
        observedOutput: number | null;
      }
    >
  >;
};

export function compareCatalog(usage: ModelUsageSummary, settings: GradyModelSettings): CompareCatalog {
  const features: CompareCatalog["features"] = {};
  for (const feature of COMPARE_FEATURES) {
    const row = usage.features[feature];
    features[feature] = {
      samples: COMPARE_SAMPLES[feature].map(({ id, label, lang }) => ({ id, label, lang })),
      sampleChars: sampleChars(feature),
      observedOutput: row && row.calls > 0 ? Math.round(row.outputTokens / row.calls) : null,
    };
  }
  return { judge: chooseModel("compare_judge", settings).model.key, features };
}
