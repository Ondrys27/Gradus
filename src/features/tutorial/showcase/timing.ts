import { seedOf, typingDuration } from "./motion";
import type { ShowcaseStep } from "./types";

/**
 * About how long a scenario plays (step 27.4), from its steps alone: the
 * cursor's glide and the breath after a click, typing at the human pace,
 * pauses, and a moment for what the app does after a click (a page, an
 * answer). Close to what a recording measures on a warm server; the
 * scenarios are kept between 30 and 60 seconds by it (Vitest).
 */

const GLIDE_MS = 750;
/** The glide, the press, the breath after it and the app answering the click. */
const CLICK_MS = GLIDE_MS + 90 + 450 + 300;
/** A target that has to appear first (a page, an answer, a dialog). */
const APPEAR_MS = 1500;

export function estimateStep(step: ShowcaseStep, fill: (text: string) => string = (text) => text) {
  const after = step.after ?? 0;
  switch (step.kind) {
    case "caption":
      return after;
    case "move":
      return GLIDE_MS + 250 + after;
    case "click":
      return (step.optional ? 0 : CLICK_MS) + after;
    case "type":
      return CLICK_MS + typingDuration(fill(step.text), seedOf(step.key)) + (step.enter ? 320 : 0) + 300 + after;
    case "drag":
      return 700 + GLIDE_MS + 160 + 1400 + 280 + 450 + after;
    case "scroll":
      return 800 + after;
    case "wait":
      return (step.ms ?? (step.until || step.gone ? 0 : 1000)) + (step.until || step.gone ? APPEAR_MS : 0) + after;
    case "cue":
      return 300 + after;
  }
}

export function estimateScenario(steps: readonly ShowcaseStep[], fill?: (text: string) => string): number {
  return steps.reduce((sum, step) => sum + estimateStep(step, fill), 0);
}
