import { describe, expect, it } from "vitest";
import {
  completeStep,
  EMPTY_DRAFT,
  firstUnfinished,
  nextStep,
  parseDraft,
  previousStep,
  resolveStep,
  STEP_SLUGS,
  stepFromSlug,
  withIndustry,
  withMode,
  type WizardDraft,
  type WizardStep,
} from "./wizard-state";

function finished(draft: WizardDraft, ...steps: Parameters<typeof completeStep>[1][]) {
  return steps.reduce((d, step) => completeStep(d, step).draft, draft);
}

const toolSoFar = finished(
  { ...EMPTY_DRAFT, mode: "tool", industry: "coaching" },
  "welcome",
  "mode",
  "industry",
  "region",
);

describe("step slugs", () => {
  it("round-trip every step and reject anything else", () => {
    for (const step of Object.keys(STEP_SLUGS) as WizardStep[]) {
      expect(stepFromSlug(STEP_SLUGS[step])).toBe(step);
    }
    expect(stepFromSlug("obor")).toBe("industry");
    expect(stepFromSlug("industry")).toBeNull();
    expect(stepFromSlug("")).toBeNull();
    expect(stepFromSlug(null)).toBeNull();
  });
});

describe("resolveStep", () => {
  it("starts a new account at the welcome", () => {
    expect(resolveStep(null, EMPTY_DRAFT)).toBe("welcome");
    expect(resolveStep("welcome", EMPTY_DRAFT)).toBe("welcome");
  });

  it("keeps any step up to the first unfinished one (a reload stays put)", () => {
    expect(firstUnfinished(toolSoFar)).toBe("milestone");
    for (const step of ["welcome", "mode", "industry", "region", "milestone"] as const) {
      expect(resolveStep(step, toolSoFar)).toBe(step);
    }
  });

  it("sends a step typed in ahead of time to the first unfinished one", () => {
    expect(resolveStep("contact", toolSoFar)).toBe("milestone");
    expect(resolveStep("closing", toolSoFar)).toBe("milestone");
    expect(resolveStep("contact", EMPTY_DRAFT)).toBe("welcome");
  });

  it("sends a step of the other mode to the first unfinished one", () => {
    expect(resolveStep("path", toolSoFar)).toBe("milestone");
  });

  it("does not count a step as done without its answer", () => {
    const broken = finished(EMPTY_DRAFT, "welcome", "mode");
    expect(firstUnfinished(broken)).toBe("mode");
    expect(resolveStep("industry", broken)).toBe("mode");
  });

  it("allows the closing screen once every step is done", () => {
    const all = finished(toolSoFar, "milestone", "contact");
    expect(firstUnfinished(all)).toBe("closing");
    expect(resolveStep("closing", all)).toBe("closing");
    expect(resolveStep(null, all)).toBe("closing");
  });
});

describe("previousStep and nextStep", () => {
  it("have no Back on the welcome and go one step either way", () => {
    expect(previousStep("welcome", "game")).toBeNull();
    expect(previousStep("mode", "game")).toBe("welcome");
    expect(previousStep("region", "game")).toBe("path");
    expect(previousStep("region", "tool")).toBe("industry");
    expect(previousStep("closing", "tool")).toBe("contact");
    expect(nextStep("industry", "game")).toBe("path");
    expect(nextStep("industry", "tool")).toBe("region");
    expect(nextStep("contact", "game")).toBe("closing");
  });
});

describe("completeStep", () => {
  it("is first only once, so going back and on is not counted again", () => {
    const once = completeStep(EMPTY_DRAFT, "welcome");
    expect(once.first).toBe(true);
    const again = completeStep(once.draft, "welcome");
    expect(again.first).toBe(false);
    expect(again.draft.done).toEqual(["welcome"]);
  });
});

describe("changing an answer", () => {
  it("a new branch forgets the picked path and asks for the path again", () => {
    const game = finished(
      { ...EMPTY_DRAFT, mode: "game", industry: "coaching", pathKey: "coach" },
      "welcome",
      "mode",
      "industry",
      "path",
      "region",
    );
    const changed = withIndustry(game, "trades");
    expect(changed.pathKey).toBeNull();
    expect(changed.done).not.toContain("path");
    expect(firstUnfinished(changed)).toBe("path");
    expect(withIndustry(game, "coaching")).toBe(game);
  });

  it("switching tool to game leads through the path; the region stays done", () => {
    const toGame = withMode(finished(toolSoFar, "milestone"), "game");
    expect(firstUnfinished(toGame)).toBe("path");
    expect(resolveStep("region", toGame)).toBe("path");
    const pathDone = completeStep(toGame, "path").draft;
    expect(firstUnfinished(pathDone)).toBe("contact");
  });
});

describe("parseDraft", () => {
  it("reads a stored draft and drops anything foreign", () => {
    const stored = JSON.stringify({
      mode: "tool",
      industry: "coaching",
      pathKey: null,
      done: ["welcome", "mode", "mode", "hacked"],
    });
    expect(parseDraft(stored)).toEqual({
      mode: "tool",
      industry: "coaching",
      pathKey: null,
      done: ["welcome", "mode"],
    });
  });

  it("falls back to an empty draft", () => {
    expect(parseDraft(null)).toEqual(EMPTY_DRAFT);
    expect(parseDraft("{not json")).toEqual(EMPTY_DRAFT);
    expect(parseDraft(JSON.stringify({ mode: "boss", industry: 3, done: "x" }))).toEqual(
      EMPTY_DRAFT,
    );
  });
});
