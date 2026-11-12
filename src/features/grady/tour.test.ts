import { describe, expect, it } from "vitest";
import { GRADY_QUESTIONS, nextQuestion, normalizeAnswer, questionDedupeKey } from "./questions";
import { findFirstTarget, findTourTarget, placeCallout, pointDirection } from "./tour";

describe("placeCallout", () => {
  const viewport = { width: 1440, height: 900 };
  const callout = { width: 450, height: 300 };

  it("stands below a target at the top and points up at it", () => {
    const placed = placeCallout(
      { top: 16, left: 1300, width: 44, height: 44 },
      callout,
      viewport,
      140,
    );
    expect(placed.side).toBe("below");
    expect(placed.top).toBe(16 + 44 + 12);
    // Target on the right: Grady at the right end, the callout kept on screen.
    expect(placed.flip).toBe(true);
    expect(placed.left + callout.width).toBeLessThanOrEqual(viewport.width - 16);
    expect(placed.direction).toMatch(/^up/);
  });

  it("goes above a target near the bottom", () => {
    const placed = placeCallout(
      { top: 820, left: 20, width: 80, height: 64 },
      callout,
      { width: 390, height: 844 },
      140,
    );
    expect(placed.side).toBe("above");
    expect(placed.top + callout.height).toBeLessThanOrEqual(820);
    expect(placed.left).toBe(16);
  });

  it("centres the last step, which has no target", () => {
    const placed = placeCallout(null, callout, viewport, 140);
    expect(placed).toMatchObject({ side: "center", left: (1440 - 450) / 2, top: (900 - 300) / 2 });
  });

  it("points the arm the right way", () => {
    expect(pointDirection(-200, 10)).toBe("left");
    expect(pointDirection(200, -10)).toBe("right");
    expect(pointDirection(5, -200)).toBe("up");
    expect(pointDirection(-150, -150)).toBe("up-left");
    expect(pointDirection(150, -150)).toBe("up-right");
    expect(pointDirection(20, 200)).toBe("down");
  });
});

describe("findTourTarget", () => {
  it("skips copies that are not on screen", () => {
    document.body.innerHTML = `<a data-tour="nav-dashboard" id="hidden"></a><a data-tour="nav-dashboard" id="shown"></a>`;
    const shown = document.getElementById("shown")!;
    shown.getBoundingClientRect = () => ({ width: 40, height: 40 }) as DOMRect;
    expect(findTourTarget("nav-dashboard")?.id).toBe("shown");
    expect(findTourTarget("missing")).toBeNull();
  });

  it("finds a data-tutorial name, a CSS selector, and the first of several that is shown", () => {
    document.body.innerHTML = `<button data-tutorial="note-new" id="note"></button><div id="settings-grady-frequency"></div>`;
    for (const id of ["note", "settings-grady-frequency"]) {
      document.getElementById(id)!.getBoundingClientRect = () => ({ width: 40, height: 40 }) as DOMRect;
    }
    expect(findTourTarget("note-new")?.id).toBe("note");
    expect(findTourTarget("#settings-grady-frequency")?.id).toBe("settings-grady-frequency");
    expect(findTourTarget("[broken")).toBeNull();
    expect(findFirstTarget(["pipeline-health", "note-new"])?.id).toBe("note");
    expect(findFirstTarget([])).toBeNull();
  });
});

describe("questions", () => {
  it("asks the monthly goal again each month and the others once", () => {
    const goal = GRADY_QUESTIONS.find((q) => q.key === "monthlyGoal")!;
    expect(questionDedupeKey(goal, "2026-10-03")).toBe("question:monthlyGoal:2026-10");
    const asked = new Set(GRADY_QUESTIONS.map((q) => questionDedupeKey(q, "2026-10-03")));
    expect(nextQuestion(asked, "2026-10-20")).toBeNull();
    expect(nextQuestion(asked, "2026-11-01")?.key).toBe("monthlyGoal");
    expect(nextQuestion(new Set(), "2026-10-03")?.key).toBe("monthlyGoal");
  });

  it("accepts an option, a free answer only where allowed, and nothing empty", () => {
    const hours = GRADY_QUESTIONS.find((q) => q.key === "callingHours")!;
    const goal = GRADY_QUESTIONS.find((q) => q.key === "monthlyGoal")!;
    expect(normalizeAnswer(hours, "h5")).toBe("h5");
    expect(normalizeAnswer(hours, "lots")).toBeNull();
    expect(normalizeAnswer(goal, "  Three   new clients ")).toBe("Three new clients");
    expect(normalizeAnswer(goal, "   ")).toBeNull();
    expect(normalizeAnswer(goal, "x".repeat(500))).toHaveLength(300);
  });
});
