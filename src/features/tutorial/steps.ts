import type { NavKey } from "@/components/layout/nav-items";
import { TUTORIAL_CHECKS, type TutorialCheck, type TutorialCheckKey } from "./checks";
import type { RunningMode } from "./types";

/**
 * The tutorial as data. Each step says where it happens (`section`, `path`
 * opened when it starts), what Jarvis says (a fixed text under
 * `tutorial.steps.<key>` in en.json / cs.json, never a model), what lights up
 * (`highlight`: `data-tutorial` / `data-tour` names or a CSS selector, the
 * first one visible wins), whether the user only looks or does it, and for
 * "do" the check that tells it is done and a hint after a while without
 * activity. The quick look is the former guided tour, widened to every
 * section; the full tutorial lets the user try it on sample data.
 */

export type TutorialSection = NavKey | "jarvis" | "settings";

export type TutorialChapter =
  | "start"
  | "milestones"
  | "notes"
  | "contacts"
  | "pipeline"
  | "tasks"
  | "calendar"
  | "finance"
  | "company"
  | "jarvis"
  | "end";

type StepBase = {
  key: string;
  section: TutorialSection;
  chapter: TutorialChapter;
  /** Opened when the step begins, unless the user is already on it or below it; null stays put. */
  path: string | null;
  /** The translation key of what Jarvis says (under `tutorial`). */
  jarvisSays: string;
  highlight: readonly string[];
  skippable: boolean;
};

export type LookStep = StepBase & { action: "look" };
export type DoStep = StepBase & {
  action: "do";
  check: TutorialCheck;
  checkKey: TutorialCheckKey;
  /** Shown after HINT_AFTER_MS without activity while the check has not passed. */
  hint: string;
};
export type TutorialStep = LookStep | DoStep;

function look(
  key: string,
  chapter: TutorialChapter,
  section: TutorialSection,
  path: string | null,
  highlight: readonly string[],
): LookStep {
  return {
    key,
    chapter,
    section,
    path,
    jarvisSays: `steps.${key}.text`,
    highlight,
    action: "look",
    skippable: true,
  };
}

function act(
  key: string,
  chapter: TutorialChapter,
  section: TutorialSection,
  path: string | null,
  highlight: readonly string[],
  checkKey: TutorialCheckKey,
): DoStep {
  return {
    key,
    chapter,
    section,
    path,
    jarvisSays: `steps.${key}.text`,
    highlight,
    action: "do",
    check: TUTORIAL_CHECKS[checkKey],
    checkKey,
    hint: `steps.${key}.hint`,
    skippable: true,
  };
}

/** The quick look of an owner: one step per section, 1–2 sentences each. */
const QUICK_OWNER: readonly TutorialStep[] = [
  look("dashboard", "start", "dashboard", "/app", ["nav-dashboard"]),
  look("milestones", "milestones", "milestones", "/app/milniky", ["nav-milestones"]),
  look("notes", "notes", "notes", "/app/poznamky", ["nav-notes"]),
  look("contacts", "contacts", "contacts", "/app/kontakty", ["nav-contacts"]),
  look("pipeline", "pipeline", "pipeline", "/app/pipeline", ["pipeline-health", "nav-pipeline"]),
  look("tasks", "tasks", "tasks", "/app/ukoly-crm", ["nav-tasks"]),
  look("calendar", "calendar", "calendar", "/app/kalendar", ["nav-calendar"]),
  look("finance", "finance", "finance", "/app/finance", ["nav-finance"]),
  look("company", "company", "workers", "/app/firma", ["nav-workers"]),
  look("messages", "company", "messages", "/app/zpravy", ["nav-messages"]),
  look("jarvis", "jarvis", "jarvis", null, ["jarvis"]),
  look("level", "jarvis", "dashboard", null, ["level"]),
  look("settings", "end", "settings", null, ["account"]),
  look("finish", "end", "dashboard", null, []),
];

/** A worker's own environment, short. */
const QUICK_WORKER: readonly TutorialStep[] = [
  look("workerDashboard", "start", "dashboard", "/app", ["nav-dashboard"]),
  look("workerTasks", "tasks", "tasks", "/app/ukoly-crm", ["nav-tasks"]),
  look("messages", "company", "messages", "/app/zpravy", ["nav-messages"]),
  look("jarvis", "jarvis", "jarvis", null, ["jarvis"]),
  look("settings", "end", "settings", null, ["account"]),
  look("workerFinish", "end", "dashboard", null, []),
];

/** The full tutorial: the user tries every part on the sample data. */
const FULL: readonly TutorialStep[] = [
  look("welcome", "start", "dashboard", "/app", []),
  look("dashboard", "start", "dashboard", "/app", ["nav-dashboard"]),
  look("milestonesLook", "milestones", "milestones", "/app/milniky", ["demo-milestone", "nav-milestones"]),
  act("milestoneCreate", "milestones", "milestones", "/app/milniky", ["milestone-new"], "milestoneCreated"),
  act("taskAdd", "milestones", "milestones", "/app/milniky", ["task-add"], "taskCreated"),
  act("taskMove", "milestones", "milestones", "/app/milniky", ["task-view"], "taskMoved"),
  act("noteWrite", "notes", "notes", "/app/poznamky", ["note-new"], "noteWritten"),
  look("contactsLook", "contacts", "contacts", "/app/kontakty", ["nav-contacts"]),
  act("contactCreate", "contacts", "contacts", "/app/kontakty", ["contact-new"], "contactCreated"),
  look("coldCallingLook", "contacts", "coldCalling", "/app/cold-calling", ["nav-coldCalling"]),
  act("coldCallingMove", "contacts", "coldCalling", "/app/cold-calling", [], "contactMoved"),
  act("dealFromContact", "contacts", "pipeline", null, [], "dealCreated"),
  look("pipelineLook", "pipeline", "pipeline", "/app/pipeline", ["nav-pipeline"]),
  act("dealCloseDate", "pipeline", "pipeline", "/app/pipeline", [], "closeDateSet"),
  act("dealTask", "pipeline", "pipeline", "/app/pipeline", [], "dealTaskCreated"),
  look("healthTiles", "pipeline", "pipeline", "/app/pipeline", ["pipeline-health"]),
  look("tasksLook", "tasks", "tasks", "/app/ukoly-crm", ["nav-tasks"]),
  act("taskComplete", "tasks", "tasks", "/app/ukoly-crm", [], "crmTaskDone"),
  look("calendarLook", "calendar", "calendar", "/app/kalendar", ["nav-calendar"]),
  look("financeLook", "finance", "finance", "/app/finance", ["nav-finance"]),
  act(
    "invoiceDraft",
    "finance",
    "finance",
    "/app/finance?tab=invoices",
    ["invoice-new"],
    "invoiceCreated",
  ),
  look("companyLook", "company", "workers", "/app/firma", ["nav-workers"]),
  look("messagesLook", "company", "messages", "/app/zpravy", ["nav-messages"]),
  act("jarvisAsk", "jarvis", "jarvis", null, ["jarvis"], "jarvisAsked"),
  act(
    "jarvisFrequency",
    "jarvis",
    "settings",
    "/app/nastaveni/jarvis",
    ["#settings-jarvis-frequency"],
    "jarvisFrequency",
  ),
  look("settingsLook", "end", "settings", null, ["account"]),
  look("finish", "end", "dashboard", null, []),
];

export type TutorialAudience = { worker: boolean; playing: boolean };

/**
 * Every step of a tutorial for this account, before locks are applied. The
 * level step only in game mode; a worker gets the short look of their own
 * environment (no sample data: the full tutorial is the owner's own space).
 */
export function tutorialSteps(mode: RunningMode, audience: TutorialAudience): TutorialStep[] {
  if (audience.worker) return [...QUICK_WORKER];
  const steps = mode === "full" ? FULL : QUICK_OWNER;
  return steps.filter((step) => audience.playing || step.key !== "level");
}

/** Every step key that exists (each has its texts in both languages). */
export const TUTORIAL_STEP_KEYS: readonly string[] = [
  ...new Set([...QUICK_OWNER, ...QUICK_WORKER, ...FULL].map((step) => step.key)),
];

/** Rough length shown on the choice cards, in minutes. */
export const TUTORIAL_MINUTES: Record<RunningMode, number> = { quick: 2, full: 15 };
