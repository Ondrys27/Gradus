import { z } from "zod";
import { elementAllowed, type GuideAudience } from "../ui-map/access";
import type { GuideSection, UiElement } from "../ui-map/types";

/**
 * What Grady's own guide (30.8, job guide_answer) answers and how the
 * answer becomes steps on screen, without React and without the model: the
 * shape the model must keep, then the checks every answer goes through.
 * Only keys of the catalog survive (anything else is dropped and Grady
 * says in words what he knows), only elements the person has (a step on
 * something they may not open turns the answer into "you do not have this,
 * ask the owner"), the elements to open first are put in front, and a step
 * in another section is led there first.
 */

/** What a step asks: go to the element's section, open it, look, press, fill in, wait for the user. */
export const GUIDE_ACTIONS = ["go", "open", "highlight", "click", "fill", "wait"] as const;
export type GuideAction = (typeof GUIDE_ACTIONS)[number];

/** How the answer is meant: steps on screen, words only, a business question for the chat, no right, no such feature. */
export const GUIDE_KINDS = ["steps", "words", "chat", "noRight", "missing"] as const;
export type GuideKind = (typeof GUIDE_KINDS)[number];

export const GUIDE_MAX_STEPS = 10;
export const GUIDE_ANSWER_MAX = 600;
export const GUIDE_SAY_MAX = 160;

const say = z.string().trim().max(400).optional();

/** The model's answer as JSON; loose where it may be sloppy, cut to size afterwards. */
export const guideModelAnswerSchema = z.object({
  kind: z.enum(["steps", "words", "chat", "no_right", "missing", "noRight"]),
  answer: z.string().trim().min(1).max(2000),
  steps: z
    .array(z.object({ key: z.string().trim().min(1).max(80), action: z.string().trim().max(20), say }))
    .max(30)
    .optional(),
  /** The model was not sure what is meant: the answer is asked again on a larger model. */
  unclear: z.boolean().optional(),
});
export type GuideModelAnswer = z.infer<typeof guideModelAnswerSchema>;

export type GuidePlanStep = { key: string; action: GuideAction; say?: string };

/** What goes back to the browser and into the cache. */
export type GuidePlan = {
  kind: GuideKind;
  answer: string;
  steps: GuidePlanStep[];
  /** Steps the model gave that are not in the catalog (or are families): dropped. */
  dropped: number;
  /** For "no right": the sections of what was asked about. */
  blockedSections: GuideSection[];
};

export const guidePlanSchema = z.object({
  kind: z.enum(GUIDE_KINDS),
  answer: z.string().max(GUIDE_ANSWER_MAX + 5),
  steps: z
    .array(
      z.object({
        key: z.string().max(80),
        action: z.enum(GUIDE_ACTIONS),
        say: z.string().max(GUIDE_SAY_MAX + 5).optional(),
      }),
    )
    .max(GUIDE_MAX_STEPS),
  dropped: z.number().int().min(0),
  blockedSections: z.array(z.string().max(40)),
});

function cut(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function toAction(value: string, element: UiElement): GuideAction {
  const action = (GUIDE_ACTIONS as readonly string[]).includes(value) ? (value as GuideAction) : null;
  if (action === "fill" && !element.input) return "click";
  if (action) return action;
  return element.input ? "fill" : "highlight";
}

export type PlanContext = {
  elements: ReadonlyMap<string, UiElement>;
  audience: GuideAudience;
  /** The section the person is in when they ask: a step elsewhere is led there first. */
  section: GuideSection | null;
};

/**
 * The answer as it may be played. Unknown and family keys are dropped; steps
 * on elements the person does not have are left out and remembered; an
 * element's `via` (what to open first) is put in front unless the answer
 * already has it; a step whose element is in another section than the one
 * before gets a "go" in front (Grady leads there); at most GUIDE_MAX_STEPS.
 */
export function planFromAnswer(answer: GuideModelAnswer, context: PlanContext): GuidePlan {
  const kindOf = (kind: GuideModelAnswer["kind"]): GuideKind =>
    kind === "no_right" ? "noRight" : kind;
  let kind = kindOf(answer.kind);
  const text = cut(answer.answer, GUIDE_ANSWER_MAX);
  let dropped = 0;
  const blocked = new Set<GuideSection>();
  const valid: { element: UiElement; action: GuideAction; say?: string }[] = [];

  for (const step of answer.steps ?? []) {
    const element = context.elements.get(step.key);
    if (!element || element.prefix) {
      dropped += 1;
      continue;
    }
    if (!elementAllowed(element, context.audience)) {
      blocked.add(element.section);
      continue;
    }
    valid.push({
      element,
      action: toAction(step.action, element),
      ...(step.say ? { say: cut(step.say, GUIDE_SAY_MAX) } : {}),
    });
  }

  // "No right" from the model is believed only with nothing playable left; steps the person
  // may take win over a refusal, and a refusal names the sections it is about.
  if (kind === "noRight" && valid.length > 0) kind = "steps";
  if (kind === "steps" && valid.length === 0) kind = blocked.size > 0 ? "noRight" : "words";
  if (kind !== "steps") {
    return { kind, answer: text, steps: [], dropped, blockedSections: [...blocked] };
  }

  const steps: GuidePlanStep[] = [];
  const has = (key: string) => steps.some((step) => step.key === key);
  let section = context.section;
  const push = (element: UiElement, action: GuideAction, sayText?: string) => {
    // An element reachable from anywhere (Grady's panel) needs no leading there.
    if (action !== "go" && element.path && element.section !== section) {
      // The previous "go" already leads to this section.
      const last = steps.at(-1);
      if (!(last?.action === "go" && context.elements.get(last.key)?.section === element.section)) {
        steps.push({ key: element.key, action: "go" });
      }
      section = element.section;
    }
    if (action === "go") section = element.section;
    steps.push({ key: element.key, action, ...(sayText ? { say: sayText } : {}) });
  };

  for (const { element, action, say: sayText } of valid) {
    if (action === "go") {
      if (element.section === section) continue;
      push(element, "go");
      continue;
    }
    for (const key of element.via ?? []) {
      const before = context.elements.get(key);
      if (!before || has(key) || before.prefix || !elementAllowed(before, context.audience)) continue;
      push(before, "open");
    }
    if (has(element.key) && action === "highlight") continue;
    push(element, action, sayText);
  }

  // A plan that ends on its "go" leads somewhere and shows nothing: the element itself closes it.
  const last = steps.at(-1);
  if (last?.action === "go") steps.push({ key: last.key, action: "highlight" });

  return {
    kind,
    answer: text,
    steps: steps.slice(0, GUIDE_MAX_STEPS),
    dropped,
    blockedSections: [...blocked],
  };
}
