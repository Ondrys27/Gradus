import { describe, expect, it } from "vitest";
import { AI_MODELS } from "@/config/costs";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";
import {
  allowedChoices,
  applyPreset,
  AUTO,
  chooseModel,
  DEFAULT_GRADY_MODELS,
  economyFor,
  FEATURE_MODELS,
  gradyModelsFormSchema,
  largeChoices,
  matchingPreset,
  needsAutoPick,
  resolveGradyModels,
  SETTABLE_FEATURES,
  SHOWN_FEATURES,
  toGradyModelsForm,
  toStoredGradyModels,
  type GradyModelSettings,
} from "./model-settings";
import { aiModelByKey, defaultModelKey, GRADY_FEATURES, GRADY_MODELS } from "./models";

const rank = (key: string) => aiModelByKey(key)!.rank;

const stored = (features: Record<string, string>, extra: Partial<{ economy: boolean; chat_large: string | null }> = {}) => ({
  features,
  economy: false,
  chat_large: null,
  ...extra,
});

describe("the catalog of jobs", () => {
  it("has every job, with today's assignment as the default and the minimum below it", () => {
    for (const feature of GRADY_FEATURES) {
      const spec = FEATURE_MODELS[feature];
      expect(spec, feature).toBeDefined();
      const recommended = spec.recommended === AUTO ? "sonnet" : spec.recommended;
      expect(recommended, feature).toBe(defaultModelKey(feature));
      expect(rank(spec.minimum), feature).toBeLessThanOrEqual(rank(recommended));
      if (spec.quality !== AUTO) expect(rank(spec.quality), feature).toBeGreaterThanOrEqual(rank(spec.minimum));
    }
  });

  it("puts the chat on auto by default and only the chat may be auto", () => {
    expect(DEFAULT_GRADY_MODELS.features.chat).toBe(AUTO);
    for (const feature of GRADY_FEATURES) {
      expect(allowedChoices(feature).includes(AUTO), feature).toBe(feature === "chat");
    }
  });

  it("never offers a model below a job's minimum", () => {
    expect(allowedChoices("analysis")).not.toContain("haiku");
    expect(allowedChoices("reward_setup")).not.toContain("haiku");
    expect(allowedChoices("milestone_review")).toEqual(AI_MODELS.map((model) => model.key));
    expect(allowedChoices("chat_route")).toEqual(["haiku"]);
  });

  it("keeps the routing call and the comparison out of the settings", () => {
    expect(SETTABLE_FEATURES).toEqual(
      GRADY_FEATURES.filter((feature) => feature !== "chat_route" && feature !== "model_compare"),
    );
  });

  it("names, explains and justifies every job the administration lists, in both languages", () => {
    for (const locale of [cs, en]) {
      const features = locale.admin.ai.models.features as Record<
        string,
        { name: string; does: string; why: string }
      >;
      for (const feature of SHOWN_FEATURES) {
        expect(features[feature]?.name, feature).toBeTruthy();
        expect(features[feature]?.does, feature).toBeTruthy();
        expect(features[feature]?.why, feature).toBeTruthy();
      }
    }
  });

  it("offers only models above Sonnet for the chat's big analyses", () => {
    expect(largeChoices()).toEqual(["opus", "fable"]);
  });
});

describe("resolveGradyModels", () => {
  it("gives the defaults without a stored value", () => {
    expect(resolveGradyModels(null)).toEqual({ settings: DEFAULT_GRADY_MODELS, problems: [] });
  });

  it("reads a stored value, missing jobs on their default", () => {
    const { settings, problems } = resolveGradyModels(
      stored({ chat: "haiku", briefing: "opus" }, { economy: true, chat_large: "fable" }),
    );
    expect(problems).toEqual([]);
    expect(settings.features.chat).toBe("haiku");
    expect(settings.features.briefing).toBe("opus");
    expect(settings.features.analysis).toBe("opus");
    expect(settings).toMatchObject({ economy: true, chatLarge: "fable", source: "database" });
  });

  it("falls back to the default for an unknown model and reports it", () => {
    const { settings, problems } = resolveGradyModels(stored({ chat: "gpt", briefing: "mythos" }));
    expect(settings.features.chat).toBe(AUTO);
    expect(settings.features.briefing).toBe("sonnet");
    expect(problems).toEqual(["unknown_model:chat:gpt", "unknown_model:briefing:mythos"]);
  });

  it("raises a model below the minimum to it, and refuses auto outside the chat", () => {
    const { settings, problems } = resolveGradyModels(
      stored({ analysis: "haiku", briefing: "auto", chat_route: "opus" }),
    );
    expect(settings.features.analysis).toBe("sonnet");
    expect(settings.features.briefing).toBe("sonnet");
    // The routing call is fixed: a stored value for it is ignored.
    expect(settings.features.chat_route).toBe("haiku");
    expect(problems).toEqual(["below_minimum:analysis:haiku", "auto_not_allowed:briefing"]);
  });

  it("drops a big-analysis model that is not above Sonnet", () => {
    const { settings, problems } = resolveGradyModels(stored({}, { chat_large: "haiku" }));
    expect(settings.chatLarge).toBeNull();
    expect(problems).toEqual(["unknown_model:chat_large:haiku"]);
  });

  it("treats an unreadable value as the defaults", () => {
    expect(resolveGradyModels({ features: [] })).toEqual({
      settings: DEFAULT_GRADY_MODELS,
      problems: ["unreadable"],
    });
  });
});

describe("the form and the presets", () => {
  const form = toGradyModelsForm(DEFAULT_GRADY_MODELS);

  it("round-trips through the stored value", () => {
    const value = toStoredGradyModels(form);
    expect(resolveGradyModels(value).settings.features).toEqual(DEFAULT_GRADY_MODELS.features);
    expect(gradyModelsFormSchema.safeParse(form).success).toBe(true);
  });

  it("refuses a model below a job's minimum, auto outside the chat and a small big-analysis model", () => {
    const bad = [
      { ...form, features: { ...form.features, reward_setup: "haiku" } },
      { ...form, features: { ...form.features, briefing: AUTO } },
      { ...form, features: { ...form.features, chat: "gpt" } },
      { ...form, chatLarge: "sonnet" },
      { ...form, features: { ...form.features, chat_route: "haiku" } },
    ];
    for (const value of bad) expect(gradyModelsFormSchema.safeParse(value).success).toBe(false);
  });

  it("Economy puts everything that may on Haiku, the rest on its minimum", () => {
    const economy = applyPreset(form, "economy");
    for (const feature of SETTABLE_FEATURES) {
      expect(economy.features[feature], feature).toBe(FEATURE_MODELS[feature].minimum);
    }
    expect(economy.features.chat).toBe("haiku");
    expect(economy.features.analysis).toBe("sonnet");
    expect(economy.chatLarge).toBeNull();
    expect(matchingPreset(economy)).toBe("economy");
  });

  it("Balanced is the defaults, Quality goes up and allows Opus for big analyses", () => {
    expect(applyPreset(form, "balanced")).toEqual(form);
    expect(matchingPreset(form)).toBe("balanced");
    const quality = applyPreset(form, "quality");
    expect(quality.chatLarge).toBe("opus");
    expect(quality.features.milestone_review).toBe("opus");
    expect(gradyModelsFormSchema.safeParse(quality).success).toBe(true);
    expect(matchingPreset({ ...quality, chatLarge: null })).toBeNull();
  });

  it("keeps economy mode as it was set", () => {
    expect(applyPreset({ ...form, economy: true }, "quality").economy).toBe(true);
  });
});

describe("chooseModel", () => {
  const settings = (changes: Partial<GradyModelSettings> = {}): GradyModelSettings => ({
    ...DEFAULT_GRADY_MODELS,
    ...changes,
  });
  const set = (features: Partial<GradyModelSettings["features"]>, rest: Partial<GradyModelSettings> = {}) =>
    settings({ ...rest, features: { ...DEFAULT_GRADY_MODELS.features, ...features } });

  it("runs a job on its setting, without a routed-from", () => {
    expect(chooseModel("briefing", set({ briefing: "opus" }))).toEqual({
      model: aiModelByKey("opus"),
      routedFrom: null,
    });
  });

  it("asks the guide again on Sonnet after an unsure answer, never in economy mode", () => {
    expect(chooseModel("guide_answer", settings()).model.key).toBe("haiku");
    expect(chooseModel("guide_answer", settings(), { escalated: true })).toEqual({
      model: aiModelByKey("sonnet"),
      routedFrom: null,
    });
    // Set higher than the escalation: the setting stays.
    expect(chooseModel("guide_answer", set({ guide_answer: "opus" }), { escalated: true }).model.key).toBe("opus");
    expect(chooseModel("guide_answer", settings(), { escalated: true, economy: "manual" }).model.key).toBe("haiku");
    // A job without an escalation ignores it.
    expect(chooseModel("briefing", settings(), { escalated: true }).model.key).toBe("sonnet");
  });

  it("never goes below the minimum", () => {
    // A value that slipped past the form (or a minimum raised later).
    expect(chooseModel("analysis", set({ analysis: "haiku" })).model.key).toBe("sonnet");
  });

  it("takes the automatic pick for the chat and logs Sonnet as what it would have been", () => {
    const auto = settings();
    expect(chooseModel("chat", auto, { auto: "haiku" })).toEqual({
      model: aiModelByKey("haiku"),
      routedFrom: GRADY_MODELS.sonnet,
    });
    expect(chooseModel("chat", auto, { auto: "sonnet" }).routedFrom).toBe(GRADY_MODELS.sonnet);
    expect(chooseModel("chat", auto).model.key).toBe("sonnet");
  });

  it("uses Opus or Fable automatically only when big analyses may", () => {
    expect(chooseModel("chat", settings(), { auto: "large" }).model.key).toBe("sonnet");
    expect(chooseModel("chat", settings({ chatLarge: "fable" }), { auto: "large" }).model.key).toBe(
      "fable",
    );
  });

  it("ignores the automatic pick when the chat has a fixed model", () => {
    expect(chooseModel("chat", set({ chat: "opus" }), { auto: "haiku" })).toEqual({
      model: aiModelByKey("opus"),
      routedFrom: null,
    });
  });

  it("puts every job on its minimum in economy mode and logs the model it saved", () => {
    expect(chooseModel("briefing", settings(), { economy: "budget" })).toEqual({
      model: aiModelByKey("haiku"),
      routedFrom: GRADY_MODELS.sonnet,
    });
    expect(chooseModel("analysis", settings(), { economy: "user_cap" })).toEqual({
      model: aiModelByKey("sonnet"),
      routedFrom: GRADY_MODELS.opus,
    });
    // Already on the minimum: nothing was routed.
    expect(chooseModel("classify", settings(), { economy: "budget" }).routedFrom).toBeNull();
    // Economy wins over the automatic pick and a fixed model.
    expect(chooseModel("chat", set({ chat: "opus" }), { economy: "space_cap", auto: "large" })).toEqual({
      model: aiModelByKey("haiku"),
      routedFrom: GRADY_MODELS.opus,
    });
  });

  it("switches economy mode on by hand from the settings", () => {
    const manual = settings({ economy: true });
    expect(economyFor(manual, null)).toBe("manual");
    expect(economyFor(manual, "budget")).toBe("budget");
    expect(economyFor(settings(), null)).toBeNull();
    expect(chooseModel("email_reply", manual).model.key).toBe("haiku");
  });

  it("asks for the automatic pick only for the chat on auto without economy mode", () => {
    expect(needsAutoPick("chat", settings(), null)).toBe(true);
    expect(needsAutoPick("chat", settings(), "budget")).toBe(false);
    expect(needsAutoPick("chat", set({ chat: "haiku" }), null)).toBe(false);
    expect(needsAutoPick("briefing", settings(), null)).toBe(false);
  });

  it("keeps the routing call on Haiku whatever is set", () => {
    expect(chooseModel("chat_route", settings({ economy: true })).model.key).toBe("haiku");
  });
});

describe("step 28.9: the comparison runs on the model it names", () => {
  it("takes the named model for the comparison only, even in economy mode", () => {
    const settings = { ...DEFAULT_GRADY_MODELS, economy: true };
    expect(chooseModel("model_compare", settings, { explicit: "opus" }).model.key).toBe("opus");
    expect(chooseModel("email_reply", DEFAULT_GRADY_MODELS, { explicit: "opus" }).model.key).toBe(
      "sonnet",
    );
    expect(allowedChoices("model_compare")).toEqual(["sonnet"]);
    expect(SETTABLE_FEATURES).not.toContain("model_compare");
    expect(SETTABLE_FEATURES).toContain("compare_judge");
  });
});
