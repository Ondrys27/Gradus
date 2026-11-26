import { navItemsFor, type NavKey } from "@/components/layout/nav-items";
import { can, workspaceFor, type Workspace } from "@/features/account/workspace";
import type { GrantSection, PermissionGrants } from "@/features/workers/permissions-catalog";
import { TUTORIAL_CHECKS, type TutorialCheck, type TutorialCheckKey } from "./checks";
import type { RunningMode } from "./types";

/**
 * The tutorial as data. Each step says where it happens (`section`, `path`
 * opened when it starts), what Grady says (a fixed text under
 * `tutorial.steps.<key>` in en.json / cs.json, never a model), what lights up
 * (`highlight`: `data-tutorial` / `data-tour` names or a CSS selector, the
 * first one visible wins), whether the user only looks or does it, and for
 * "do" the check that tells it is done and a hint after a while without
 * activity. The quick look is the former guided tour, widened to every
 * section; the full tutorial lets the user try it on sample data.
 *
 * A worker in a company (30.2) gets both too, built from the steps of only
 * the sections their rights open (the same menu the app shows them) and,
 * for "do", only actions their rights allow (`needs`).
 */

export type TutorialSection = NavKey | "grady" | "settings";

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
  | "grady"
  | "end";

type StepBase = {
  /**
   * Stored in `profiles.tutorial.step` and sent as `tutorial_step.key`, so the
   * steps about the assistant keep their keys (`jarvis`, `jarvisAsk`,
   * `jarvisFrequency`): DB name kept from Jarvis.
   */
  key: string;
  section: TutorialSection;
  chapter: TutorialChapter;
  /** Opened when the step begins, unless the user is already on it or below it; null stays put. */
  path: string | null;
  /** The translation key of what Grady says (under `tutorial`). */
  gradySays: string;
  highlight: readonly string[];
  skippable: boolean;
  /** What a worker needs for it besides the section being open to them (30.2). */
  needs?: readonly StepNeed[];
};

/** A right of the catalog, or any of these sections in the worker's menu. */
export type StepNeed = { right: readonly [GrantSection, string] } | { nav: readonly NavKey[] };

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
  needs?: readonly StepNeed[],
): LookStep {
  return {
    ...(needs ? { needs } : {}),
    key,
    chapter,
    section,
    path,
    gradySays: `steps.${key}.text`,
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
  needs?: readonly StepNeed[],
): DoStep {
  return {
    ...(needs ? { needs } : {}),
    key,
    chapter,
    section,
    path,
    gradySays: `steps.${key}.text`,
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
  look("dashboard", "start", "dashboard", "/app", ["dashboard-widgets", "nav-dashboard"]),
  look("milestones", "milestones", "milestones", "/app/milniky", ["nav-milestones"]),
  look("notes", "notes", "notes", "/app/poznamky", ["nav-notes"]),
  look("contacts", "contacts", "contacts", "/app/kontakty", ["nav-contacts"]),
  look("pipeline", "pipeline", "pipeline", "/app/pipeline", ["pipeline-health", "nav-pipeline"]),
  look("tasks", "tasks", "tasks", "/app/ukoly-crm", ["nav-tasks"]),
  look("calendar", "calendar", "calendar", "/app/kalendar", ["nav-calendar"]),
  look("finance", "finance", "finance", "/app/finance", ["nav-finance"]),
  look("company", "company", "workers", "/app/firma", ["nav-workers"]),
  look("messages", "company", "messages", "/app/zpravy", ["nav-messages"]),
  look("jarvis", "grady", "grady", null, ["grady"]),
  look("level", "grady", "dashboard", null, ["level"]),
  look("settings", "end", "settings", null, ["account"]),
  look("finish", "end", "dashboard", null, []),
];

/** The full tutorial: the user tries every part on the sample data. */
const FULL: readonly TutorialStep[] = [
  look("welcome", "start", "dashboard", "/app", []),
  look("dashboard", "start", "dashboard", "/app", ["dashboard-widgets", "nav-dashboard"]),
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
  act("jarvisAsk", "grady", "grady", null, ["grady"], "gradyAsked"),
  act(
    "jarvisFrequency",
    "grady",
    "settings",
    "/app/nastaveni/grady",
    ["#settings-grady-frequency"],
    "gradyFrequency",
  ),
  look("settingsLook", "end", "settings", null, ["account"]),
  look("finish", "end", "dashboard", null, []),
];

const right = (section: GrantSection, action: string): StepNeed => ({ right: [section, action] });
const nav = (...keys: NavKey[]): StepNeed => ({ nav: keys });
/** A sample deal or contact to hang a task on: either section in the menu. */
const RECORDS = nav("pipeline", "contacts", "coldCalling");

/**
 * A worker's quick look (30.2): who they work for, then one step per section
 * their menu has (their own dashboard, notes, tasks, rewards and messages
 * always), the rest only with the rights that open it.
 */
const QUICK_WORKER: readonly TutorialStep[] = [
  look("workerWelcome", "start", "dashboard", "/app", []),
  look("workerDashboard", "start", "dashboard", "/app", ["dashboard-widgets", "nav-dashboard"]),
  look("workerMilestones", "milestones", "milestones", "/app/milniky", ["nav-milestones"]),
  look("workerNotes", "notes", "notes", "/app/poznamky", ["nav-notes"]),
  look("workerContacts", "contacts", "contacts", "/app/kontakty", ["nav-contacts"]),
  look("workerColdCalling", "contacts", "coldCalling", "/app/cold-calling", ["nav-coldCalling"]),
  look("workerPipeline", "pipeline", "pipeline", "/app/pipeline", ["pipeline-health", "nav-pipeline"]),
  look("workerTasks", "tasks", "tasks", "/app/ukoly-crm", ["nav-tasks"]),
  look("calendar", "calendar", "calendar", "/app/kalendar", ["nav-calendar"]),
  look("workerFinance", "finance", "finance", "/app/finance", ["nav-finance"]),
  look("workerRewards", "company", "myRewards", "/app/odmeny", ["nav-myRewards"]),
  look("workerMessages", "company", "messages", "/app/zpravy", ["nav-messages"]),
  look("workerCompany", "company", "workers", "/app/firma", ["nav-workers"]),
  look("jarvis", "grady", "grady", null, ["grady"]),
  look("level", "grady", "dashboard", null, ["level"]),
  look("settings", "end", "settings", null, ["account"]),
  look("workerFinish", "end", "dashboard", null, []),
];

/**
 * A worker's full tutorial (30.2): the owner's steps of the sections and
 * actions their rights allow, on sample data seeded only there
 * (tutorial_seed_worker_demo). Grady sees no notes in a company, so the
 * question to him is about the day; the frequency of his messages is the
 * owner's own business.
 */
const FULL_WORKER: readonly TutorialStep[] = [
  look("workerWelcomeFull", "start", "dashboard", "/app", []),
  look("workerDashboard", "start", "dashboard", "/app", ["dashboard-widgets", "nav-dashboard"]),
  look("milestonesLook", "milestones", "milestones", "/app/milniky", ["demo-milestone", "nav-milestones"]),
  act("milestoneCreate", "milestones", "milestones", "/app/milniky", ["milestone-new"], "milestoneCreated", [
    right("milestones", "update"),
  ]),
  act("taskAdd", "milestones", "milestones", "/app/milniky", ["task-add"], "taskCreated", [
    right("milestones", "update"),
  ]),
  act("taskMove", "milestones", "milestones", "/app/milniky", ["task-view"], "taskMoved", [
    right("milestones", "update"),
  ]),
  act("noteWrite", "notes", "notes", "/app/poznamky", ["note-new"], "noteWritten"),
  look("contactsLook", "contacts", "contacts", "/app/kontakty", ["nav-contacts"]),
  act("contactCreate", "contacts", "contacts", "/app/kontakty", ["contact-new"], "contactCreated", [
    right("contacts", "create"),
  ]),
  look("coldCallingLook", "contacts", "coldCalling", "/app/cold-calling", ["nav-coldCalling"]),
  act("coldCallingMove", "contacts", "coldCalling", "/app/cold-calling", [], "contactMoved", [
    right("cold_calling", "call"),
  ]),
  act("dealFromContact", "contacts", "pipeline", null, [], "dealCreated", [
    right("pipeline", "create"),
    nav("contacts", "coldCalling"),
  ]),
  look("pipelineLook", "pipeline", "pipeline", "/app/pipeline", ["nav-pipeline"]),
  act("dealCloseDate", "pipeline", "pipeline", "/app/pipeline", [], "closeDateSet", [
    right("pipeline", "update"),
  ]),
  act("dealTask", "pipeline", "pipeline", "/app/pipeline", [], "dealTaskCreated", [right("tasks", "create")]),
  look("healthTiles", "pipeline", "pipeline", "/app/pipeline", ["pipeline-health"]),
  look("tasksLook", "tasks", "tasks", "/app/ukoly-crm", ["nav-tasks"]),
  act("taskComplete", "tasks", "tasks", "/app/ukoly-crm", [], "crmTaskDone", [RECORDS]),
  look("calendarLook", "calendar", "calendar", "/app/kalendar", ["nav-calendar"]),
  look("financeLook", "finance", "finance", "/app/finance", ["nav-finance"]),
  act("invoiceDraft", "finance", "finance", "/app/finance?tab=invoices", ["invoice-new"], "invoiceCreated", [
    right("invoices", "issue"),
  ]),
  look("workerRewards", "company", "myRewards", "/app/odmeny", ["nav-myRewards"]),
  look("messagesLook", "company", "messages", "/app/zpravy", ["nav-messages"]),
  look("workerCompany", "company", "workers", "/app/firma", ["nav-workers"]),
  act("workerGradyAsk", "grady", "grady", null, ["grady"], "gradyAsked"),
  look("settingsLook", "end", "settings", null, ["account"]),
  look("workerFinish", "end", "dashboard", null, []),
];

/**
 * Who the tutorial is for: the owner of the space, or a worker of a company
 * with their rights there (`grants`, as the app holds them; a read-only
 * company allows no "do").
 */
export type TutorialAudience = {
  worker: boolean;
  playing: boolean;
  grants?: PermissionGrants;
  readOnly?: boolean;
};

/** The workspace of a worker with these rights (the same rules as their app). */
function workerWorkspace(audience: TutorialAudience): Workspace {
  return workspaceFor("tutorial-worker", { id: "worker", ownerId: "owner" }, audience.grants, audience.readOnly);
}

/** The worker's menu with these rights: the sections a step may point at. */
export function workerNavKeys(workspace: Workspace): Set<NavKey> {
  return new Set(
    navItemsFor({
      permissions: workspace.permissions,
      company: can(workspace, "company", "view"),
      scheduler: can(workspace, "scheduler", "own"),
    }).map((item) => item.key),
  );
}

/** Sections that are not in the menu: Grady and the account's own settings, always there. */
function isNavSection(section: TutorialSection): section is NavKey {
  return section !== "grady" && section !== "settings";
}

/** Whether a worker with this menu and these rights can take the step. */
export function stepAllowed(step: TutorialStep, workspace: Workspace, menu: ReadonlySet<NavKey>): boolean {
  if (isNavSection(step.section) && !menu.has(step.section)) return false;
  return (step.needs ?? []).every((need) =>
    "right" in need
      ? can(workspace, need.right[0], need.right[1] as never)
      : need.nav.some((key) => menu.has(key)),
  );
}

/**
 * Every step of a tutorial for this account, before game locks are applied.
 * The level step only in game mode. A worker's steps come from the sections
 * and actions their rights allow; nothing points at what they cannot open.
 */
export function tutorialSteps(mode: RunningMode, audience: TutorialAudience): TutorialStep[] {
  const playing = (step: TutorialStep) => audience.playing || step.key !== "level";
  if (!audience.worker) return (mode === "full" ? FULL : QUICK_OWNER).filter(playing);
  const workspace = workerWorkspace(audience);
  const menu = workerNavKeys(workspace);
  // A read-only company takes no change at all: only looking.
  return (mode === "full" ? FULL_WORKER : QUICK_WORKER).filter(
    (step) =>
      playing(step) && stepAllowed(step, workspace, menu) && !(audience.readOnly && step.action === "do"),
  );
}

/** The sections of a worker's menu that the quick look talks about, for "you now have access to…". */
export function tutorialSectionsOf(audience: TutorialAudience): NavKey[] {
  const menu = workerNavKeys(workerWorkspace(audience));
  return [...menu].filter((key) => QUICK_WORKER.some((step) => step.section === key));
}

/**
 * The short look at sections a worker newly has (30.2): the quick steps of
 * those sections only, then a closing word. Empty when nothing is new.
 */
export function accessTourSteps(audience: TutorialAudience, sections: readonly NavKey[]): TutorialStep[] {
  const wanted = new Set(sections);
  const steps = tutorialSteps("quick", audience).filter(
    (step) => isNavSection(step.section) && wanted.has(step.section) && step.key !== "workerDashboard",
  );
  return steps.length ? [...steps, look("accessFinish", "end", "dashboard", null, [])] : [];
}

/** Every step key that exists (each has its texts in both languages). */
export const TUTORIAL_STEP_KEYS: readonly string[] = [
  ...new Set([...QUICK_OWNER, ...QUICK_WORKER, ...FULL, ...FULL_WORKER].map((step) => step.key)),
  "accessFinish",
];

/** Rough length shown on the choice cards, in minutes. */
export const TUTORIAL_MINUTES: Record<RunningMode, number> = { quick: 2, full: 15 };
