import { describe, expect, it } from "vitest";
import { JARVIS_QUESTIONS, nextQuestion, normalizeAnswer, questionDedupeKey } from "./questions";
import { findTourTarget, placeCallout, pointDirection, tourSteps } from "./tour";

describe("tourSteps", () => {
  it("gives an owner seven steps in game mode, without the level in tool mode", () => {
    const game = tourSteps({ worker: false, playing: true }).map((step) => step.key);
    expect(game).toEqual([
      "dashboard",
      "milestones",
      "jarvis",
      "level",
      "search",
      "settings",
      "finish",
    ]);
    expect(tourSteps({ worker: false, playing: false }).map((s) => s.key)).not.toContain("level");
  });

  it("gives a worker a short version of their own environment", () => {
    const steps = tourSteps({ worker: true, playing: false });
    expect(steps.map((s) => s.key)).toEqual([
      "workerDashboard",
      "workerTasks",
      "jarvis",
      "settings",
      "workerFinish",
    ]);
    expect(steps.at(-1)?.target).toBeNull();
  });
});

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
    // Target on the right: Jarvis at the right end, the callout kept on screen.
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
});

describe("questions", () => {
  it("asks the monthly goal again each month and the others once", () => {
    const goal = JARVIS_QUESTIONS.find((q) => q.key === "monthlyGoal")!;
    expect(questionDedupeKey(goal, "2026-10-03")).toBe("question:monthlyGoal:2026-10");
    const asked = new Set(JARVIS_QUESTIONS.map((q) => questionDedupeKey(q, "2026-10-03")));
    expect(nextQuestion(asked, "2026-10-20")).toBeNull();
    expect(nextQuestion(asked, "2026-11-01")?.key).toBe("monthlyGoal");
    expect(nextQuestion(new Set(), "2026-10-03")?.key).toBe("monthlyGoal");
  });

  it("accepts an option, a free answer only where allowed, and nothing empty", () => {
    const hours = JARVIS_QUESTIONS.find((q) => q.key === "callingHours")!;
    const goal = JARVIS_QUESTIONS.find((q) => q.key === "monthlyGoal")!;
    expect(normalizeAnswer(hours, "h5")).toBe("h5");
    expect(normalizeAnswer(hours, "lots")).toBeNull();
    expect(normalizeAnswer(goal, "  Three   new clients ")).toBe("Three new clients");
    expect(normalizeAnswer(goal, "   ")).toBeNull();
    expect(normalizeAnswer(goal, "x".repeat(500))).toHaveLength(300);
  });
});
