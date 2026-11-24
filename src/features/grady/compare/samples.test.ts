import { describe, expect, it } from "vitest";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";
import { FEATURE_MODELS, SETTABLE_FEATURES } from "../model-settings";
import { GRADY_FEATURES } from "../models";
import { COMPARE_FEATURE_KEYS } from "./features";
import { JUDGE_CRITERIA } from "./judge";
import { TYPICAL_OUTPUT } from "./estimate";
import { COMPARE_FEATURES, COMPARE_SAMPLES, compareSample, isCompareFeature } from "./samples";

describe("the samples of the model comparison", () => {
  it("has 3 to 5 samples for every job it offers, each with a unique id and a short name", () => {
    for (const feature of COMPARE_FEATURES) {
      const samples: readonly { id: string; label: string }[] = COMPARE_SAMPLES[feature];
      expect(samples.length).toBeGreaterThanOrEqual(3);
      expect(samples.length).toBeLessThanOrEqual(5);
      expect(new Set(samples.map((sample) => sample.id)).size).toBe(samples.length);
      for (const sample of samples) expect(sample.label.length).toBeLessThanOrEqual(80);
    }
  });

  it("offers only real, settable jobs, and the browser's list matches the server's", () => {
    expect([...COMPARE_FEATURE_KEYS].sort()).toEqual([...COMPARE_FEATURES].sort());
    for (const feature of COMPARE_FEATURES) {
      expect(GRADY_FEATURES).toContain(feature);
      expect((SETTABLE_FEATURES as readonly string[]).includes(feature)).toBe(true);
      expect(FEATURE_MODELS[feature].shown).toBe(true);
      expect(JUDGE_CRITERIA[feature].length).toBeGreaterThan(40);
      expect(TYPICAL_OUTPUT[feature]).toBeGreaterThan(0);
    }
  });

  it("finds a sample by job and id, nothing else", () => {
    expect(isCompareFeature("chat")).toBe(true);
    expect(isCompareFeature("model_compare")).toBe(false);
    expect(compareSample("chat", "plan-day")?.lang).toBe("cs");
    expect(compareSample("chat", "../../etc")).toBeNull();
  });

  it("has every text of the dialog and the savings card in both languages", () => {
    for (const locale of [cs, en]) {
      const compare = locale.admin.ai.compare;
      for (const key of ["answered", "complete", "json", "length", "plain", "language", "shape"]) {
        expect(compare.checks[key as keyof typeof compare.checks]).toBeTruthy();
      }
      expect(locale.admin.ai.models.savings.reasons.repeats).toContain("{percent}");
      expect(locale.admin.ai.models.compareButton).toBeTruthy();
      expect(locale.admin.ai.efficiency.figures.chatAnswer).toBeTruthy();
    }
  });
});
