/**
 * Which model each of Grady's jobs runs on (step 27.3), as the owner sets it
 * in the administration (AI and Grady → Models, app_settings 'grady_models').
 * Pure: the catalog of jobs, what the stored value means, its defaults, the
 * form, the three presets and the choice of the model for one call. The
 * read with its 30-second cache is in server/model-settings.ts, the check
 * before every call in server/model.ts.
 *
 * The catalog is the one source of truth of the jobs: the default model (=
 * the assignment before 27.3), the minimum a job never goes below (a job that
 * needs structured output or reads a lot keeps a model that does it well),
 * and the Quality preset. Names, what a job does and why it runs where it
 * runs are in the translations (`admin.ai.models.features.<job>.*`).
 */
import { z } from "zod";
import { AI_MODELS, type AiModel, type AiModelKey } from "@/config/costs";
import {
  aiModelByKey,
  defaultModelKey,
  GRADY_FEATURES,
  GRADY_MODELS,
  type GradyFeature,
  type GradyModel,
} from "./models";

/** The chat may pick its model per message (chat-route.ts). */
export const AUTO = "auto" as const;
export type FeatureChoice = AiModelKey | typeof AUTO;

/** The most the automatic choice picks on its own; Opus and Fable only for big analyses when allowed. */
export const AUTO_CEILING: AiModelKey = "sonnet";

export type FeatureModelSpec = {
  /** What runs while nothing is set, and the Balanced preset. */
  recommended: FeatureChoice;
  /** Never below this; economy mode runs the job here. */
  minimum: AiModelKey;
  /** The Quality preset. */
  quality: FeatureChoice;
  /** Shown in the administration; `check` and `summary` have no caller yet. */
  shown: boolean;
  /** Chosen by the code, not settable: the chat's routing call is always one short Haiku answer. */
  fixed?: boolean;
  /** May be "auto" (only the chat). */
  auto?: boolean;
};

export const FEATURE_MODELS: Record<GradyFeature, FeatureModelSpec> = {
  chat: { recommended: AUTO, minimum: "haiku", quality: "sonnet", shown: true, auto: true },
  milestone_review: { recommended: "sonnet", minimum: "haiku", quality: "opus", shown: true },
  // Short JSON labels: Haiku is enough, a bigger model adds nothing.
  classify: { recommended: "haiku", minimum: "haiku", quality: "haiku", shown: true },
  check: { recommended: "haiku", minimum: "haiku", quality: "sonnet", shown: false },
  summary: { recommended: "haiku", minimum: "haiku", quality: "sonnet", shown: false },
  opportunity_scan: { recommended: "haiku", minimum: "haiku", quality: "sonnet", shown: true },
  // A large analysis of up to 150 questionnaires: long context and a structured write-up.
  analysis: { recommended: "opus", minimum: "sonnet", quality: "fable", shown: true },
  // The drawn reward tree's setup; no caller since 28.2 (plans are built by hand), kept for history.
  reward_setup: { recommended: "sonnet", minimum: "sonnet", quality: "opus", shown: false },
  email_reply: { recommended: "sonnet", minimum: "haiku", quality: "opus", shown: true },
  ping: { recommended: "sonnet", minimum: "haiku", quality: "sonnet", shown: true },
  briefing: { recommended: "sonnet", minimum: "haiku", quality: "opus", shown: true },
  note_map_suggest: { recommended: "sonnet", minimum: "haiku", quality: "opus", shown: true },
  // A long transcript into tasks, a stage and people: structured output on a long read, never Haiku.
  meeting_notes: { recommended: "sonnet", minimum: "sonnet", quality: "opus", shown: true },
  chat_route: { recommended: "haiku", minimum: "haiku", quality: "haiku", shown: true, fixed: true },
};

/** The jobs whose model the administration sets (all but the fixed routing call). */
export type SettableFeature = Exclude<GradyFeature, "chat_route">;
export const SETTABLE_FEATURES = GRADY_FEATURES.filter(
  (feature): feature is SettableFeature => !FEATURE_MODELS[feature].fixed,
);

/** The jobs the administration's table lists, in the catalog's order. */
export const SHOWN_FEATURES = GRADY_FEATURES.filter((feature) => FEATURE_MODELS[feature].shown);

const rankOf = (key: AiModelKey) => aiModelByKey(key)?.rank ?? 0;

/** The models a job may run on: its minimum and above, cheapest first, plus "auto" for the chat. */
export function allowedChoices(feature: GradyFeature): FeatureChoice[] {
  const spec = FEATURE_MODELS[feature];
  if (spec.fixed) return [spec.recommended];
  const models = AI_MODELS.filter((model) => model.rank >= rankOf(spec.minimum)).map(
    (model) => model.key,
  );
  return spec.auto ? [AUTO, ...models] : models;
}

/** The models the chat's automatic choice may use for big analyses when allowed: above its ceiling. */
export function largeChoices(): AiModelKey[] {
  return AI_MODELS.filter((model) => model.rank > rankOf(AUTO_CEILING)).map((model) => model.key);
}

/** The settings in force, defaults filled in. */
export type GradyModelSettings = {
  features: Record<GradyFeature, FeatureChoice>;
  /** "Economy mode now", switched on by hand: every job on its minimum. */
  economy: boolean;
  /** The model the chat's automatic choice may use for big analyses; null = never above Sonnet. */
  chatLarge: AiModelKey | null;
  source: "database" | "default";
};

function recommendedFeatures(): Record<GradyFeature, FeatureChoice> {
  return Object.fromEntries(
    GRADY_FEATURES.map((feature) => [feature, FEATURE_MODELS[feature].recommended]),
  ) as Record<GradyFeature, FeatureChoice>;
}

export const DEFAULT_GRADY_MODELS: GradyModelSettings = {
  features: recommendedFeatures(),
  economy: false,
  chatLarge: null,
  source: "default",
};

/**
 * The stored 'grady_models' value. The database checks only its shape
 * (valid_grady_models): a model that is no longer offered or a job that is
 * gone must not break a saved value, they fall back to the defaults here.
 */
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
export const storedGradyModelsSchema = z
  .object({
    features: z.record(z.string().regex(KEY), z.string().regex(KEY)),
    economy: z.boolean(),
    chat_large: z.string().regex(KEY).nullable(),
  })
  .strict();
export type StoredGradyModels = z.infer<typeof storedGradyModelsSchema>;

/**
 * The settings from the stored value, and what in it could not be used
 * (`problems`, for the error log; never user data). An unknown or
 * unavailable model falls back to the job's default, a model below the
 * job's minimum is raised to it, an unreadable value is the defaults.
 */
export function resolveGradyModels(stored: unknown): {
  settings: GradyModelSettings;
  problems: string[];
} {
  if (stored === null || stored === undefined) return { settings: DEFAULT_GRADY_MODELS, problems: [] };
  const parsed = storedGradyModelsSchema.safeParse(stored);
  if (!parsed.success) return { settings: DEFAULT_GRADY_MODELS, problems: ["unreadable"] };

  const problems: string[] = [];
  const features = recommendedFeatures();
  for (const feature of SETTABLE_FEATURES) {
    const value = parsed.data.features[feature];
    if (value === undefined) continue;
    const spec = FEATURE_MODELS[feature];
    if (value === AUTO) {
      if (spec.auto) features[feature] = AUTO;
      else problems.push(`auto_not_allowed:${feature}`);
      continue;
    }
    const model = aiModelByKey(value);
    if (!model) {
      problems.push(`unknown_model:${feature}:${value}`);
      continue;
    }
    if (model.rank < rankOf(spec.minimum)) {
      problems.push(`below_minimum:${feature}:${value}`);
      features[feature] = spec.minimum;
      continue;
    }
    features[feature] = model.key;
  }

  let chatLarge: AiModelKey | null = null;
  if (parsed.data.chat_large !== null) {
    const large = aiModelByKey(parsed.data.chat_large);
    if (large && largeChoices().includes(large.key)) chatLarge = large.key;
    else problems.push(`unknown_model:chat_large:${parsed.data.chat_large}`);
  }

  return {
    settings: { features, economy: parsed.data.economy, chatLarge, source: "database" },
    problems,
  };
}

// ---------------------------------------------------------------------------
// The administration's form
// ---------------------------------------------------------------------------

const choiceSchema = (feature: GradyFeature) =>
  z.enum(allowedChoices(feature) as [FeatureChoice, ...FeatureChoice[]]);

/** Every settable job with a model it may run on; economy mode; the chat's big analyses. */
export const gradyModelsFormSchema = z
  .object({
    features: z
      .object(
        Object.fromEntries(SETTABLE_FEATURES.map((feature) => [feature, choiceSchema(feature)])) as {
          [K in SettableFeature]: ReturnType<typeof choiceSchema>;
        },
      )
      .strict(),
    economy: z.boolean(),
    chatLarge: z.enum(largeChoices() as [AiModelKey, ...AiModelKey[]]).nullable(),
  })
  .strict();
export type GradyModelsForm = {
  features: Record<SettableFeature, FeatureChoice>;
  economy: boolean;
  chatLarge: AiModelKey | null;
};

export function toGradyModelsForm(settings: GradyModelSettings): GradyModelsForm {
  return {
    features: Object.fromEntries(
      SETTABLE_FEATURES.map((feature) => [feature, settings.features[feature]]),
    ) as Record<SettableFeature, FeatureChoice>,
    economy: settings.economy,
    chatLarge: settings.chatLarge,
  };
}

export function toStoredGradyModels(form: GradyModelsForm): StoredGradyModels {
  return {
    features: { ...form.features },
    economy: form.economy,
    chat_large: form.chatLarge,
  };
}

/** Economy: every job on its minimum (Haiku wherever it may) · Balanced: the defaults · Quality. */
export const MODEL_PRESETS = ["economy", "balanced", "quality"] as const;
export type ModelPreset = (typeof MODEL_PRESETS)[number];

/** A preset applied to the form: the jobs' models and the chat's big analyses; economy mode stays as set. */
export function applyPreset(form: GradyModelsForm, preset: ModelPreset): GradyModelsForm {
  const pick = (feature: SettableFeature): FeatureChoice => {
    const spec = FEATURE_MODELS[feature];
    if (preset === "economy") return spec.minimum;
    return preset === "quality" ? spec.quality : spec.recommended;
  };
  return {
    features: Object.fromEntries(
      SETTABLE_FEATURES.map((feature) => [feature, pick(feature)]),
    ) as Record<SettableFeature, FeatureChoice>,
    economy: form.economy,
    chatLarge: preset === "quality" ? "opus" : null,
  };
}

/** The preset the form matches exactly, or null. */
export function matchingPreset(form: GradyModelsForm): ModelPreset | null {
  return (
    MODEL_PRESETS.find((preset) => {
      const applied = applyPreset(form, preset);
      return (
        applied.chatLarge === form.chatLarge &&
        SETTABLE_FEATURES.every((feature) => applied.features[feature] === form.features[feature])
      );
    }) ?? null
  );
}

// ---------------------------------------------------------------------------
// The model of one call
// ---------------------------------------------------------------------------

/**
 * Why every job runs on its minimum now: switched on by hand, the whole
 * application past the warning threshold of its monthly cap, this user past
 * the threshold of their own cap, or the company past its owner's cap.
 */
export type EconomyReason = "manual" | "budget" | "user_cap" | "space_cap";

/** What the chat's automatic choice decided for one message (chat-route.ts). */
export type AutoPick = "haiku" | "sonnet" | "large";

export type ModelChoice = {
  model: AiModel;
  /**
   * The model the call would have run on without the automatic choice or
   * economy mode, when one of them decided (ai_usage.routed_from): the
   * administration counts what they saved. Null when the setting decided.
   */
  routedFrom: GradyModel | null;
};

/** What is set for a job: the fixed jobs always run on their default. */
export function configuredChoice(feature: GradyFeature, settings: GradyModelSettings): FeatureChoice {
  const spec = FEATURE_MODELS[feature];
  return spec.fixed ? spec.recommended : settings.features[feature];
}

/** The economy in force: the budget's reason, or the switch in the administration. */
export function economyFor(
  settings: GradyModelSettings,
  budget: EconomyReason | null | undefined,
): EconomyReason | null {
  return budget ?? (settings.economy ? "manual" : null);
}

/** Whether this call needs the chat's automatic choice (set to auto and no economy mode). */
export function needsAutoPick(
  feature: GradyFeature,
  settings: GradyModelSettings,
  economy: EconomyReason | null,
): boolean {
  return !economy && configuredChoice(feature, settings) === AUTO;
}

function model(key: AiModelKey): AiModel {
  return aiModelByKey(key) ?? aiModelByKey(defaultModelKey("chat"))!;
}

function atLeast(key: AiModelKey, minimum: AiModelKey): AiModelKey {
  return rankOf(key) >= rankOf(minimum) ? key : minimum;
}

/**
 * The model of one call: economy mode puts every job on its minimum; the
 * chat set to auto takes what the automatic choice picked (Haiku or Sonnet,
 * a big analysis the allowed large model, without a pick Sonnet); otherwise
 * the job's setting, never below its minimum.
 */
export function chooseModel(
  feature: GradyFeature,
  settings: GradyModelSettings,
  options: { economy?: EconomyReason | null; auto?: AutoPick | null } = {},
): ModelChoice {
  const spec = FEATURE_MODELS[feature];
  const choice = configuredChoice(feature, settings);
  const baseline: AiModelKey = choice === AUTO ? AUTO_CEILING : choice;
  const economy = economyFor(settings, options.economy);

  if (economy) {
    const key = spec.minimum;
    return {
      model: model(key),
      routedFrom: key === baseline ? null : GRADY_MODELS[baseline],
    };
  }
  if (choice === AUTO) {
    if (!options.auto) return { model: model(atLeast(AUTO_CEILING, spec.minimum)), routedFrom: null };
    const picked: AiModelKey =
      options.auto === "haiku"
        ? "haiku"
        : options.auto === "large"
          ? (settings.chatLarge ?? AUTO_CEILING)
          : AUTO_CEILING;
    return {
      model: model(atLeast(picked, spec.minimum)),
      routedFrom: GRADY_MODELS[baseline],
    };
  }
  return { model: model(atLeast(choice, spec.minimum)), routedFrom: null };
}
