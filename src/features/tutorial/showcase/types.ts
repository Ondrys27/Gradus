import type { TutorialSection } from "../steps";

/**
 * A showcase scenario as data (step 27.4): steps the player walks one after
 * another, each one action of the fake cursor on the real app.
 *
 * A target is a `data-tutorial` / `data-tour` name or a CSS selector (as in
 * the tutorial: the first visible one), optionally only the one whose text
 * contains `text`, optionally inside the guest's window (the public booking
 * page shown beside the app). Texts in `{braces}` are the stage's values in
 * the scenario's language (stage-data.ts): the names the seeded records
 * have, what is typed.
 */

export type ShowcaseTarget = {
  name: string;
  text?: string;
  frame?: "guest";
};

/** What the stage does that is not a click: Grady's morning summary, the guest's window closing. */
export const SHOWCASE_CUES = ["summary", "guestOpen", "guestClose"] as const;
export type ShowcaseCue = (typeof SHOWCASE_CUES)[number];

export type ShowcaseAction =
  /** The cursor glides to the target. */
  | { kind: "move"; target: ShowcaseTarget }
  /** Glides there and clicks (a ripple shows the click). `optional`: skipped when not on screen. */
  | { kind: "click"; target: ShowcaseTarget; optional?: boolean }
  /** Clicks the field and types at a human pace; `enter` presses Enter at the end. */
  | { kind: "type"; target: ShowcaseTarget; text: string; enter?: boolean }
  /** Presses on the target, carries it to `to` and lets go. */
  | { kind: "drag"; target: ShowcaseTarget; to: ShowcaseTarget }
  /** Brings the target into view, or scrolls the page by `by` pixels. */
  | { kind: "scroll"; target?: ShowcaseTarget; by?: number }
  /** A pause (`ms`), or until the target is on screen (`until`) or gone (`gone`). */
  | { kind: "wait"; ms?: number; until?: ShowcaseTarget; gone?: ShowcaseTarget }
  /** The caption at the bottom (a key under `showcase.captions`), null hides it. */
  | { kind: "caption"; caption: string | null }
  /** Something the stage shows by itself. */
  | { kind: "cue"; cue: ShowcaseCue };

export type ShowcaseStep = ShowcaseAction & {
  /** Unique within its scenario; seeds the step's wobble. */
  key: string;
  /** Where in the app it happens. */
  section: TutorialSection;
  /** A breath after the step, in ms (a default one follows every click and move). */
  after?: number;
};

export type ShowcaseScenario = {
  id: string;
  steps: readonly ShowcaseStep[];
};
