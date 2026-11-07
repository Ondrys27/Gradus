import { describe, expect, it } from "vitest";
import type { PlannedStep } from "./engine";
import {
  chapterRail,
  companionPlacement,
  emphasize,
  phoneBubbleEnd,
  plainText,
  reactionIndex,
  sliceParts,
} from "./presentation";
import type { TutorialChapter } from "./steps";

function step(key: string, chapter: TutorialChapter): PlannedStep {
  return {
    key,
    chapter,
    section: "dashboard",
    path: null,
    jarvisSays: `steps.${key}.text`,
    highlight: [],
    action: "look",
    skippable: true,
    locked: false,
  };
}

const STEPS = [
  step("a", "start"),
  step("b", "milestones"),
  step("c", "milestones"),
  step("d", "milestones"),
  step("e", "end"),
];

describe("chapterRail", () => {
  it("spans each chapter over its steps and marks where the user is", () => {
    const rail = chapterRail(STEPS, 2);
    expect(rail.map((s) => s.chapter)).toEqual(["start", "milestones", "end"]);
    expect(rail.map((s) => s.state)).toEqual(["done", "current", "ahead"]);
    expect(rail.map((s) => s.share)).toEqual([0.2, 0.6, 0.2]);
    expect(rail[0]!.fill).toBe(1);
    expect(rail[1]!.fill).toBeCloseTo(0.5);
    expect(rail[2]!.fill).toBe(0);
  });

  it("shows a sliver on the first step of a chapter and never an empty current one", () => {
    expect(chapterRail(STEPS, 1)[1]!.fill).toBeGreaterThan(0);
    expect(chapterRail(STEPS, 0)[0]!.fill).toBeGreaterThan(0);
    expect(chapterRail(STEPS, 0)[0]!.fill).toBeLessThan(1);
  });

  it("clamps the index and copes with no steps", () => {
    expect(chapterRail(STEPS, 99).map((s) => s.state)).toEqual(["done", "done", "current"]);
    expect(chapterRail([], 0)).toEqual([]);
  });
});

describe("emphasize", () => {
  it("splits the verb out of the line", () => {
    expect(emphasize("**Založ** milník a **přidej** úkol.")).toEqual([
      { text: "Založ", strong: true },
      { text: " milník a ", strong: false },
      { text: "přidej", strong: true },
      { text: " úkol.", strong: false },
    ]);
  });

  it("leaves plain and unbalanced text alone", () => {
    expect(emphasize("Jen text.")).toEqual([{ text: "Jen text.", strong: false }]);
    expect(emphasize("**bez konce")).toEqual([{ text: "**bez konce", strong: false }]);
    expect(plainText("**Založ** milník")).toBe("Založ milník");
  });

  it("slices typed text while keeping the emphasis", () => {
    const parts = emphasize("**Založ** milník");
    expect(sliceParts(parts, 3)).toEqual([{ text: "Zal", strong: true }]);
    expect(sliceParts(parts, 7)).toEqual([
      { text: "Založ", strong: true },
      { text: " m", strong: false },
    ]);
    expect(sliceParts(parts, 0)).toEqual([]);
  });
});

describe("reactionIndex", () => {
  it("is stable per step and spreads across the reactions", () => {
    expect(reactionIndex("milestoneCreate", 5)).toBe(reactionIndex("milestoneCreate", 5));
    const picks = new Set(
      ["milestoneCreate", "taskAdd", "taskMove", "noteWrite", "contactCreate", "dealTask"].map(
        (key) => reactionIndex(key, 5),
      ),
    );
    expect(picks.size).toBeGreaterThan(1);
    expect(reactionIndex("x", 0)).toBe(0);
  });
});

describe("phoneBubbleEnd", () => {
  const viewport = { width: 390, height: 844 };
  it("takes the end of the screen away from the element", () => {
    expect(phoneBubbleEnd({ top: 100, left: 0, width: 100, height: 40 }, viewport)).toBe("bottom");
    expect(phoneBubbleEnd({ top: 700, left: 0, width: 100, height: 40 }, viewport)).toBe("top");
    expect(phoneBubbleEnd(null, viewport)).toBe("bottom");
  });
});

describe("companionPlacement", () => {
  const viewport = { width: 1440, height: 900 };
  it("stands below a header button and points up", () => {
    const placed = companionPlacement(
      { top: 130, left: 1250, width: 130, height: 44 },
      viewport,
      84,
    );
    expect(placed.top).toBe(130 + 44 + 14);
    expect(placed.left).toBe(1250 + 65 - 42);
    expect(placed.direction).toBe("up");
  });

  it("stands to the left of an element lower on the page and points right", () => {
    const placed = companionPlacement(
      { top: 600, left: 1250, width: 130, height: 44 },
      viewport,
      84,
    );
    expect(placed.left).toBe(1250 - 14 - 84);
    expect(placed.direction).toBe("right");
  });

  it("moves to the right when there is no room on the left, below when neither", () => {
    const right = companionPlacement({ top: 500, left: 20, width: 120, height: 40 }, viewport, 84);
    expect(right.left).toBe(20 + 120 + 14);
    expect(right.direction).toBe("left");
    const below = companionPlacement(
      { top: 500, left: 4, width: 380, height: 40 },
      { width: 390, height: 844 },
      84,
    );
    expect(below.top).toBe(500 + 40 + 14);
    expect(below.direction).toBe("up");
  });

  it("never leaves the screen", () => {
    const placed = companionPlacement(
      { top: -20, left: 1400, width: 100, height: 30 },
      viewport,
      84,
    );
    expect(placed.top).toBeGreaterThanOrEqual(8);
    expect(placed.left + 84).toBeLessThanOrEqual(1440 - 8);
  });
});
