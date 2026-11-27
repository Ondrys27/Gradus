import { elementAllowed, type GuideAudience } from "../ui-map/access";
import type { GuideSection, SectionGuideDef, UiElement } from "../ui-map/types";
import { doableFor, type GuideStep } from "./player";

/**
 * The quick look and "everything about this section" of one section (30.8)
 * as steps of the player: an opening word, then the elements of the guide
 * the person has (rights of 30.2, the administration's powers). The quick
 * look only looks; the full guide lets them try the elements marked `do`
 * (only where they may change things), and an element inside something
 * (a deal's tab) comes after the step that opens it, so the full guide goes
 * through the page first and through details last.
 */

export type GuideDepth = "quick" | "full";
export const GUIDE_DEPTHS: readonly GuideDepth[] = ["quick", "full"];

/** Rough length shown in the menu, in minutes. */
export const GUIDE_MINUTES: Record<GuideDepth, string> = { quick: "1–2", full: "5–8" };

export function sectionGuideSteps(input: {
  guide: SectionGuideDef;
  depth: GuideDepth;
  audience: GuideAudience;
  elements: ReadonlyMap<string, UiElement>;
  /** May try things (not a read-only space); otherwise every step only looks. */
  writable: boolean;
  runId: string;
}): GuideStep[] {
  const { guide, depth, audience, elements } = input;
  const entries =
    depth === "quick"
      ? guide.quick.map((el) => ({ el, act: "look" as const }))
      : guide.full.map((step) => ({ el: step.el, act: step.act ?? ("look" as const) }));

  const usable = entries.flatMap((entry) => {
    const element = elements.get(entry.el);
    if (!element || element.prefix || !elementAllowed(element, audience)) return [];
    return [{ element, act: entry.act }];
  });
  // Inside first-level things (dialogs, details) after everything on the page; stable otherwise.
  const ordered =
    depth === "full"
      ? usable
          .map((entry, order) => ({ ...entry, order, depth: entry.element.via?.length ?? 0 }))
          .sort((a, b) => a.depth - b.depth || a.order - b.order)
      : usable.map((entry, order) => ({ ...entry, order, depth: 0 }));

  const steps: GuideStep[] = [intro(guide.section, input.runId)];
  const shown = new Set<string>();
  const add = (element: UiElement, kind: "look" | "do" | "open") => {
    const tryIt = kind === "do" && input.writable;
    const action = kind === "open" ? "open" : tryIt ? (element.input ? "fill" : "click") : "highlight";
    steps.push({
      id: `${input.runId}:${steps.length}`,
      key: element.key,
      action,
      path: element.path,
      highlight: [element.key],
      titleKey: `ui.${element.key}.name`,
      textKey: tryIt ? `ui.${element.key}.try` : `ui.${element.key}.purpose`,
      doable: action === "highlight" ? false : doableFor(action, element),
      ...(element.via?.length ? { inside: true } : {}),
    });
    shown.add(element.key);
  };
  for (const { element, act } of ordered) {
    if (shown.has(element.key)) continue;
    if (depth === "full") {
      for (const key of element.via ?? []) {
        const before = elements.get(key);
        if (before && !shown.has(key) && elementAllowed(before, audience)) add(before, "open");
      }
    } else if (element.via?.length) {
      // The quick look never opens anything: what is inside a detail waits for the full guide.
      continue;
    }
    add(element, act);
  }
  // Each step names what the next one opens.
  for (let index = 0; index < steps.length - 1; index += 1) {
    steps[index] = { ...steps[index]!, nextKey: steps[index + 1]!.key };
  }
  return steps;
}

function intro(section: GuideSection, runId: string): GuideStep {
  return {
    id: `${runId}:intro`,
    key: `intro-${section}`,
    action: "highlight",
    // Stays where the guide was opened.
    path: "",
    highlight: [],
    titleKey: `guides.${section}.name`,
    textKey: `guides.${section}.intro`,
    doable: false,
  };
}
