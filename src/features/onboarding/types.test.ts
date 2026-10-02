import { describe, expect, it } from "vitest";
import { onboardingSteps } from "./types";

describe("onboardingSteps", () => {
  it("asks for the mode right after the welcome", () => {
    for (const mode of [null, "game", "tool"] as const) {
      expect(onboardingSteps(mode).slice(0, 2)).toEqual(["welcome", "mode"]);
    }
  });

  it("picks a path in game mode instead of a hand-made milestone", () => {
    expect(onboardingSteps("game")).toEqual([
      "welcome",
      "mode",
      "industry",
      "path",
      "region",
      "contact",
    ]);
    expect(onboardingSteps(null)).toEqual(onboardingSteps("game"));
  });

  it("starts tool mode with its own first milestone and no path", () => {
    expect(onboardingSteps("tool")).toEqual([
      "welcome",
      "mode",
      "industry",
      "region",
      "milestone",
      "contact",
    ]);
  });
});
