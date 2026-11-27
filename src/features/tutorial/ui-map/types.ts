import type { AdminPower } from "@/features/admin/roles";
import type { GrantSection } from "@/features/workers/permissions-catalog";

/**
 * The shapes of the catalog of controls (30.8): every element a guide points
 * at carries `data-tutorial="<key>"` in the app and has one entry here. The
 * entries live in ui-map/<group>.ts and come together in ui-map.ts; the
 * human texts are in the translations under `tutorial.ui.<key>`:
 * `name` (what it is called on screen), `purpose` (what it is for, 1–2
 * sentences in the voice of Grady), optional `keywords` (words people ask
 * with, both languages' own, used to find it for a question) and, for an
 * element a full guide lets the user try, `try` (what to do with it).
 */

/** The sections of the app a guide is written for. */
export const APP_GUIDE_SECTIONS = [
  "dashboard",
  "milestones",
  "notes",
  "contacts",
  "coldCalling",
  "pipeline",
  "tasks",
  "calendar",
  "scheduler",
  "finance",
  "invoices",
  "company",
  "rewards",
  "messages",
  "grady",
  "settings",
  "connectedApps",
] as const;

/** The groups of the administration (nav.ts), each with its own guide. */
export const ADMIN_GUIDE_SECTIONS = [
  "adminOverview",
  "adminPeople",
  "adminProduct",
  "adminOperations",
  "adminSettings",
] as const;

export type AppGuideSection = (typeof APP_GUIDE_SECTIONS)[number];
export type AdminGuideSection = (typeof ADMIN_GUIDE_SECTIONS)[number];
export type GuideSection = AppGuideSection | AdminGuideSection;

export const GUIDE_SECTIONS: readonly GuideSection[] = [...APP_GUIDE_SECTIONS, ...ADMIN_GUIDE_SECTIONS];

export function isGuideSection(value: unknown): value is GuideSection {
  return typeof value === "string" && (GUIDE_SECTIONS as readonly string[]).includes(value);
}

export function isAdminGuideSection(section: GuideSection): section is AdminGuideSection {
  return (ADMIN_GUIDE_SECTIONS as readonly string[]).includes(section);
}

/**
 * What someone needs to have the element at all: a right of the catalog
 * (30.2, `permissions-catalog.ts`; the section's "view" is implied by the
 * section being in their menu), being the owner of the space (the owner's
 * settings, the reward system) or a worker in it, or a power of the
 * administration (roles.ts).
 */
export type UiNeed =
  | { right: readonly [GrantSection, string] }
  | { owner: true }
  /** Only a worker in someone else's company has it (their own rewards, tasks from the owner). */
  | { worker: true }
  | { power: AdminPower };

export type UiElement = {
  /** The element's `data-tutorial` value; with `prefix`, the start of a family (`widget-…`). */
  key: string;
  section: GuideSection;
  /** The page it is on, as the menu opens it (may carry `?tab=`). */
  path: string;
  /**
   * Elements to open first, in order, when it is not on the page by itself:
   * a deal's Tasks tab is `via: ["deal-card"]` (open a deal → the Tasks tab).
   */
  via?: readonly string[];
  needs?: readonly UiNeed[];
  /**
   * Pressing it only opens, closes or switches something (a dialog, a tab, a
   * menu, a view, another page) and saves nothing: Grady may press it for
   * the user ("Do it for me").
   */
  safe?: boolean;
  /** A field or form the user fills in: a step on it waits until something is typed. */
  input?: boolean;
  /** A family: every element whose key starts with this (`widget-`, `task-view-`). Never a guide target. */
  prefix?: boolean;
};

/** One step of a section guide: look at an element, or (full guide only) try it. */
export type GuideStepDef = { el: string; act?: "look" | "do" };

/**
 * The guide of one section: the quick look (5–8 elements, only looking) and
 * everything about it (every element of the section, the ones behind
 * "More options" too, the ones worth trying marked `do`). Texts: the name,
 * an opening sentence and three example questions under
 * `tutorial.guides.<section>` (`name`, `intro`, `examples.q1`…`q3`).
 */
export type SectionGuideDef = {
  section: GuideSection;
  quick: readonly string[];
  full: readonly GuideStepDef[];
};
