import type { UiElement } from "../ui-map/types";
import type { GuideAction } from "./plan";
import { onPage, sectionPlace } from "./sections";

/**
 * The player of a guide (30.8), without React: section guides and Grady's
 * own answers play the same steps. A step says what to show (an element of
 * the catalog, or for "go" the menu item of its section), whether the user
 * only looks or does it, and when it is done — always by what is on the
 * screen, never by a guess: the page is the step's page ("go"), the user
 * pressed the element or what it opens is there ("open", "click"), they typed
 * into it ("fill"), it went away or the app saved something ("wait").
 */

export type GuideStep = {
  /** Unique within the run. */
  id: string;
  /** The element of the catalog. */
  key: string;
  action: GuideAction;
  /** The page of the element (for "go": the page to lead to); empty = wherever the user is. */
  path: string;
  /** What lights up: the element, or the menu item of its section for "go". */
  highlight: readonly string[];
  /** What Grady says: a translation key… */
  textKey?: string;
  /** …or what the model wrote for this step. */
  say?: string;
  /** The title: the element's name (translation key). */
  titleKey: string;
  /** Grady may do it for the user: lead to the page, or press a control that only opens something. */
  doable: boolean;
  /**
   * The element is inside something opened first (`via`: a dialog, a detail,
   * a tab): on a page under the step's page (an invoice's detail under the
   * list) it is already where it should be.
   */
  inside?: boolean;
  /** The next step's element, which counts as "what this one opened". */
  nextKey?: string;
};

export function isLook(action: GuideAction): boolean {
  return action === "highlight";
}

/** What the screen shows right now, as the overlay reads it. */
export type ScreenState = {
  pathname: string;
  search: string;
  /** The user pressed the lit element since the step began. */
  pressed: boolean;
  /** The user typed into it since the step began. */
  typed: boolean;
  /** The next step's element is on the screen. */
  nextVisible: boolean;
  /** The lit element was on the screen and is gone now (a dialog saved and closed). */
  targetGone: boolean;
  /** The app saved something since the step began. */
  saved: boolean;
};

/** Whether the step is done; a look is done at once. */
export function stepDone(step: GuideStep, screen: ScreenState): boolean {
  switch (step.action) {
    case "highlight":
      return true;
    case "go":
      return onPage(step.path, screen.pathname, screen.search);
    case "open":
    case "click":
      return screen.pressed || screen.nextVisible;
    case "fill":
      return screen.typed;
    case "wait":
      return screen.saved || screen.targetGone || screen.nextVisible;
  }
}

/** "Do it for me": leading to a page always, pressing only what saves nothing (`safe`). */
export function doableFor(action: GuideAction, element: UiElement | undefined): boolean {
  if (action === "go") return true;
  if (action === "open" || action === "click") return Boolean(element?.safe);
  return false;
}

/**
 * Where the step needs the user to be: a "go" step waits for them to get
 * there (or does it for them); any other step on a page they are not on is
 * opened, unless the element is inside something on the page they are on
 * (`via` — a dialog over a list keeps the list's page).
 */
export function navigationFor(step: GuideStep, pathname: string, search: string): string | null {
  if (step.action === "go" || !step.path) return null;
  if (onPage(step.path, pathname, search)) return null;
  if (step.inside && onPage(step.path.split("?")[0]!, pathname)) return null;
  return step.path;
}

/** The steps of a plan as the player takes them; "go" lights the section's menu item. */
export function toGuideSteps(
  plan: readonly { key: string; action: GuideAction; say?: string; textKey?: string }[],
  elements: ReadonlyMap<string, UiElement>,
  runId: string,
): GuideStep[] {
  const steps: GuideStep[] = [];
  plan.forEach((entry, index) => {
    const element = elements.get(entry.key);
    if (!element) return;
    const place = sectionPlace(element.section);
    const go = entry.action === "go";
    steps.push({
      id: `${runId}:${index}`,
      key: element.key,
      action: entry.action,
      // Led to the element's own page (a worker's rewards are not the owner's), else the section's.
      path: go ? element.path || place.path : element.path,
      highlight: go ? place.nav : [element.key],
      titleKey: go ? `guides.${element.section}.name` : `ui.${element.key}.name`,
      ...(entry.say ? { say: entry.say } : {}),
      ...(entry.textKey ? { textKey: entry.textKey } : go ? { textKey: "guide.goTo" } : {}),
      doable: doableFor(entry.action, element),
      ...(element.via?.length ? { inside: true } : {}),
    });
  });
  for (let index = 0; index < steps.length - 1; index += 1) {
    const next = steps[index + 1]!;
    if (next.action !== "go") steps[index] = { ...steps[index]!, nextKey: next.key };
  }
  return steps;
}

/** The index after a step: the next one, or the end. */
export function nextIndex(index: number, total: number): number | "end" {
  return index + 1 < total ? index + 1 : "end";
}
