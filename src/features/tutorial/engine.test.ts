import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkQuery, runCheck, TUTORIAL_CHECKS } from "./checks";
import {
  atStep,
  canAdvance,
  choiceDue,
  endState,
  HINT_AFTER_MS,
  highlightOf,
  hintDue,
  isRunning,
  navigationFor,
  planSteps,
  resumeHow,
  resumeIndex,
  RESUME_DIRECTLY_MS,
  startState,
} from "./engine";
import { emitTutorialSignal, resetTutorialSignals } from "./signals";
import { TUTORIAL_STEP_KEYS, tutorialSteps, type TutorialSection } from "./steps";
import { parseTutorialState } from "./types";

const NOW = new Date("2026-11-07T10:00:00Z");
const none = { locked: new Set<TutorialSection>(), missing: new Set<TutorialSection>() };
const owner = { worker: false, playing: false };

describe("tutorialSteps", () => {
  it("gives the quick look about a dozen look-only steps over every section", () => {
    const steps = tutorialSteps("quick", { worker: false, playing: true });
    expect(steps.length).toBeGreaterThanOrEqual(12);
    expect(steps.length).toBeLessThanOrEqual(15);
    expect(steps.every((step) => step.action === "look")).toBe(true);
    const sections = new Set(steps.map((step) => step.section));
    for (const section of [
      "dashboard",
      "milestones",
      "notes",
      "contacts",
      "pipeline",
      "tasks",
      "calendar",
      "finance",
      "workers",
      "messages",
      "jarvis",
      "settings",
    ] as const) {
      expect(sections.has(section)).toBe(true);
    }
    expect(steps.at(-1)?.key).toBe("finish");
    expect(tutorialSteps("quick", owner).map((step) => step.key)).not.toContain("level");
  });

  it("gives the full tutorial 25–35 steps, hands-on ones with a check and a hint", () => {
    const steps = tutorialSteps("full", owner);
    expect(steps.length).toBeGreaterThanOrEqual(25);
    expect(steps.length).toBeLessThanOrEqual(35);
    const doing = steps.filter((step) => step.action === "do");
    expect(doing.length).toBeGreaterThanOrEqual(10);
    for (const step of doing) {
      expect(step.check).toBe(TUTORIAL_CHECKS[step.checkKey]);
      expect(step.hint).toBe(`steps.${step.key}.hint`);
    }
    // In the order of the brief: milestone → task → map → note → contact → cold calling → deal → … → frequency.
    const order = doing.map((step) => step.key);
    expect(order.indexOf("milestoneCreate")).toBeLessThan(order.indexOf("dealFromContact"));
    expect(order.indexOf("coldCallingMove")).toBeLessThan(order.indexOf("dealFromContact"));
    expect(order.indexOf("invoiceDraft")).toBeLessThan(order.indexOf("jarvisAsk"));
    expect(order.at(-1)).toBe("jarvisFrequency");
  });

  it("gives a worker the short look of their own environment, never the full one", () => {
    const steps = tutorialSteps("full", { worker: true, playing: false });
    expect(steps.map((step) => step.key)).toEqual([
      "workerDashboard",
      "workerTasks",
      "messages",
      "jarvis",
      "settings",
      "workerFinish",
    ]);
  });

  it("has every text of every step in both languages", () => {
    const steps = [
      ...tutorialSteps("quick", { worker: false, playing: true }),
      ...tutorialSteps("full", owner),
      ...tutorialSteps("quick", { worker: true, playing: false }),
    ];
    for (const locale of ["cs", "en"]) {
      const messages = JSON.parse(
        readFileSync(path.resolve(__dirname, `../../locales/${locale}.json`), "utf8"),
      ).tutorial;
      for (const key of TUTORIAL_STEP_KEYS) {
        expect(messages.steps[key]?.title, `${locale} ${key}`).toBeTruthy();
        expect(messages.steps[key]?.text, `${locale} ${key}`).toBeTruthy();
      }
      for (const step of steps) {
        expect(messages.chapters[step.chapter], `${locale} ${step.chapter}`).toBeTruthy();
        if (step.action === "do") expect(messages.steps[step.key].hint).toBeTruthy();
      }
    }
  });
});

describe("planSteps", () => {
  it("leaves out trying a locked section and points a look at its menu item", () => {
    const planned = planSteps(tutorialSteps("full", owner), {
      locked: new Set<TutorialSection>(["contacts", "coldCalling", "pipeline"]),
      missing: new Set(),
    });
    const keys = planned.map((step) => step.key);
    expect(keys).not.toContain("contactCreate");
    expect(keys).not.toContain("dealFromContact");
    expect(keys).toContain("contactsLook");
    const look = planned.find((step) => step.key === "contactsLook")!;
    expect(look.locked).toBe(true);
    expect(highlightOf(look)).toEqual(["nav-contacts"]);
    expect(navigationFor(look, "/app")).toBeNull();
  });

  it("leaves out whole sections the account does not have", () => {
    const planned = planSteps(tutorialSteps("quick", owner), {
      locked: new Set(),
      missing: new Set<TutorialSection>(["finance"]),
    });
    expect(planned.map((step) => step.section)).not.toContain("finance");
  });
});

describe("navigationFor", () => {
  const planned = planSteps(tutorialSteps("full", owner), none);
  const step = (key: string) => planned.find((item) => item.key === key)!;

  it("opens the step's section unless the user is already in it", () => {
    expect(navigationFor(step("contactsLook"), "/app")).toBe("/app/kontakty");
    expect(navigationFor(step("contactsLook"), "/app/kontakty")).toBeNull();
    expect(navigationFor(step("taskAdd"), "/app/milniky/123")).toBeNull();
    expect(navigationFor(step("dashboard"), "/app/milniky")).toBe("/app");
    expect(navigationFor(step("dashboard"), "/app")).toBeNull();
    expect(navigationFor(step("jarvisAsk"), "/app/kalendar")).toBeNull();
  });

  it("switches to the invoices tab, but not away from an invoice being written", () => {
    expect(navigationFor(step("invoiceDraft"), "/app/finance")).toBe("/app/finance?tab=invoices");
    expect(navigationFor(step("invoiceDraft"), "/app/finance/faktury/nova")).toBeNull();
  });
});

describe("progress", () => {
  it("starts, moves on and ends with what the database accepts", () => {
    const started = startState("full", NOW, "2026-11-07T09:59:58.123456+00:00");
    expect(started).toMatchObject({ mode: "full", step: null, finished_at: null, outcome: null });
    expect(started.started_at).toBe("2026-11-07T09:59:58.123456+00:00");
    expect(isRunning(started)).toBe(true);

    const moved = atStep(started, "taskAdd", new Date("2026-11-07T10:05:00Z"));
    expect(moved.step).toBe("taskAdd");
    expect(parseTutorialState(JSON.parse(JSON.stringify(moved)))).toEqual(moved);

    const done = endState(moved, "finished", new Date("2026-11-07T10:20:00Z"), "deleted");
    expect(done).toMatchObject({ outcome: "finished", demo: "deleted" });
    expect(isRunning(done)).toBe(false);
  });

  it("ends a skipped choice at once", () => {
    const skipped = startState("none", NOW);
    expect(skipped).toMatchObject({ mode: "none", outcome: "skipped" });
    expect(isRunning(skipped)).toBe(false);
  });

  it("goes on at once after a reload and offers it later", () => {
    const state = atStep(startState("quick", NOW), "pipeline", NOW);
    expect(resumeHow(state, new Date(NOW.getTime() + RESUME_DIRECTLY_MS))).toBe("direct");
    expect(resumeHow(state, new Date(NOW.getTime() + RESUME_DIRECTLY_MS + 1))).toBe("offer");
    expect(resumeHow({ ...state, updated_at: null, started_at: null }, NOW)).toBe("offer");
  });

  it("picks up at the stored step, or at the next one still offered", () => {
    const order = tutorialSteps("full", owner);
    const all = planSteps(order, none);
    expect(all[resumeIndex(all, order, "dealCloseDate")]?.key).toBe("dealCloseDate");
    expect(resumeIndex(all, order, null)).toBe(0);
    expect(resumeIndex(all, order, "noSuchStep")).toBe(0);

    // The section got locked meanwhile (back to game mode): the next step after it.
    const locked = planSteps(order, {
      locked: new Set<TutorialSection>(["contacts", "coldCalling"]),
      missing: new Set(),
    });
    expect(locked[resumeIndex(locked, order, "contactCreate")]?.key).toBe("coldCallingLook");
  });

  it("asks once after onboarding (a worker on the first visit), never after a choice or the old tour", () => {
    const base = { state: null, tourCompletedAt: null, onboarded: true, worker: false };
    expect(choiceDue(base)).toBe(true);
    expect(choiceDue({ ...base, onboarded: false })).toBe(false);
    expect(choiceDue({ ...base, onboarded: false, worker: true })).toBe(true);
    expect(choiceDue({ ...base, tourCompletedAt: "2026-10-01T08:00:00Z" })).toBe(false);
    expect(choiceDue({ ...base, state: startState("none", NOW) })).toBe(false);
  });
});

describe("parseTutorialState", () => {
  it("reads what is stored and refuses what is not a state", () => {
    expect(parseTutorialState({ mode: "quick" })).toEqual({
      mode: "quick",
      step: null,
      started_at: null,
      updated_at: null,
      finished_at: null,
      outcome: null,
      demo: null,
    });
    expect(parseTutorialState(null)).toBeNull();
    expect(parseTutorialState({ mode: "everything" })).toBeNull();
    expect(parseTutorialState({ mode: "full", step: "<b>" })).toBeNull();
    expect(parseTutorialState("full")).toBeNull();
  });
});

describe("steps and checks", () => {
  const look = tutorialSteps("quick", owner)[0]!;
  const doing = tutorialSteps("full", owner).find((step) => step.key === "contactCreate")!;

  it("lets Next through a look at once and a hands-on step once done", () => {
    expect(canAdvance(look, false)).toBe(true);
    expect(canAdvance(doing, false)).toBe(false);
    expect(canAdvance(doing, true)).toBe(true);
  });

  it("gives the hint after 30 s without activity, only while not done", () => {
    expect(hintDue(doing, false, 0, HINT_AFTER_MS - 1)).toBe(false);
    expect(hintDue(doing, false, 0, HINT_AFTER_MS)).toBe(true);
    expect(hintDue(doing, true, 0, HINT_AFTER_MS)).toBe(false);
    expect(hintDue(look, false, 0, HINT_AFTER_MS)).toBe(false);
  });

  it("counts only the user's own rows made after the start, in their space", () => {
    const context = { workspaceId: "space", userId: "me", since: "2026-11-07T09:00:00Z" };
    expect(checkQuery(TUTORIAL_CHECKS.contactCreated, context)).toEqual({
      table: "contacts",
      filters: [
        ["eq", "user_id", "space"],
        ["gt", "created_at", "2026-11-07T09:00:00Z"],
        ["eq", "is_demo", false],
      ],
    });
    // The sample note filled in counts too, a trashed note does not.
    expect(checkQuery(TUTORIAL_CHECKS.noteWritten, context).filters).toEqual([
      ["eq", "user_id", "space"],
      ["gt", "updated_at", "2026-11-07T09:00:00Z"],
      ["is", "deleted_at", null],
    ]);
    expect(checkQuery(TUTORIAL_CHECKS.dealTaskCreated, context).filters).toContainEqual([
      "not.is",
      "deal_id",
      null,
    ]);
    // Jarvis's chat is the account's own, not the space's.
    expect(checkQuery(TUTORIAL_CHECKS.jarvisAsked, context).filters).toEqual([
      ["eq", "user_id", "me"],
      ["gt", "created_at", "2026-11-07T09:00:00Z"],
      ["eq", "role", "user"],
    ]);
  });
});

describe("runCheck", () => {
  afterEach(() => resetTutorialSignals());
  const context = { workspaceId: "space", userId: "me", since: "2026-11-07T09:00:00Z" };

  function client(count: number | null, error: unknown = null) {
    const calls: unknown[][] = [];
    const query = {
      eq: (...args: unknown[]) => (calls.push(["eq", ...args]), query),
      gt: (...args: unknown[]) => (calls.push(["gt", ...args]), query),
      is: (...args: unknown[]) => (calls.push(["is", ...args]), query),
      not: (...args: unknown[]) => (calls.push(["not", ...args]), query),
      then: (resolve: (value: unknown) => void) => resolve({ count, error }),
    };
    return {
      calls,
      client: { from: () => ({ select: () => query }) } as never,
    };
  }

  it("passes when a matching row exists and fails quietly on an error", async () => {
    const found = client(1);
    expect(await runCheck(TUTORIAL_CHECKS.dealCreated, context, found.client)).toBe(true);
    expect(found.calls).toContainEqual(["eq", "is_demo", false]);
    expect(await runCheck(TUTORIAL_CHECKS.dealCreated, context, client(0).client)).toBe(false);
    expect(
      await runCheck(TUTORIAL_CHECKS.dealCreated, context, client(null, { message: "x" }).client),
    ).toBe(false);
  });

  it("passes a signal step only by a signal after the start", async () => {
    const unused = client(0).client;
    emitTutorialSignal("taskMoved", Date.parse("2026-11-07T08:00:00Z"));
    expect(await runCheck(TUTORIAL_CHECKS.taskMoved, context, unused)).toBe(false);
    emitTutorialSignal("taskMoved", Date.parse("2026-11-07T09:30:00Z"));
    expect(await runCheck(TUTORIAL_CHECKS.taskMoved, context, unused)).toBe(true);
  });
});
