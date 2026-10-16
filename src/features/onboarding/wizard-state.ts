import { z } from "zod";
import type { GameMode } from "@/features/game/types";
import { INDUSTRY_KEYS, type IndustryKey } from "./industries";
import { onboardingSteps, type OnboardingStep } from "./types";

/**
 * Where the first-login wizard is and what has been answered, kept apart from
 * React so the rules can be tested: which step the address may show, which
 * one comes before, and when finishing a step counts for the first time.
 *
 * The step lives in the address (`?krok=obor`), so the browser's Back and
 * Forward move between steps and a reload stays on the step. The answers
 * live in a small draft in this browser (see `wizard-draft.ts`); anything
 * the wizard already saved to the database is looked up there, not here.
 */

/** Every screen of the wizard, including the closing one after the last step. */
export type WizardStep = OnboardingStep | "closing";

/** The query parameter holding the step. */
export const STEP_PARAM = "krok";

/** The step's name in the address; the app's routes are Czech. */
export const STEP_SLUGS: Record<WizardStep, string> = {
  welcome: "uvod",
  mode: "rezim",
  industry: "obor",
  path: "cesta",
  region: "region",
  milestone: "milnik",
  contact: "kontakt",
  closing: "hotovo",
};

export function stepFromSlug(slug: string | null | undefined): WizardStep | null {
  if (!slug) return null;
  const found = (Object.keys(STEP_SLUGS) as WizardStep[]).find((step) => STEP_SLUGS[step] === slug);
  return found ?? null;
}

export type WizardDraft = {
  mode: GameMode | null;
  industry: IndustryKey | null;
  /** The path picked in game mode; null = the one suggested for the industry. */
  pathKey: string | null;
  /** Steps finished at least once (Continue pressed and whatever it saves, saved). */
  done: OnboardingStep[];
};

export const EMPTY_DRAFT: WizardDraft = { mode: null, industry: null, pathKey: null, done: [] };

/** The screens in order for the chosen mode, closing last. */
export function wizardSequence(mode: GameMode | null): WizardStep[] {
  return [...onboardingSteps(mode), "closing"];
}

/** A step counts as done only with the answer it asks for. */
export function isStepDone(step: OnboardingStep, draft: WizardDraft): boolean {
  if (!draft.done.includes(step)) return false;
  if (step === "mode") return draft.mode !== null;
  if (step === "industry") return draft.industry !== null;
  return true;
}

/** The first step not finished yet; the closing screen once all of them are. */
export function firstUnfinished(draft: WizardDraft): WizardStep {
  for (const step of onboardingSteps(draft.mode)) {
    if (!isStepDone(step, draft)) return step;
  }
  return "closing";
}

/**
 * The step to show for what the address asks: any step up to the first
 * unfinished one. A step typed in by hand, an old one from another mode or
 * one further ahead quietly becomes the first unfinished step.
 */
export function resolveStep(requested: WizardStep | null, draft: WizardDraft): WizardStep {
  const sequence = wizardSequence(draft.mode);
  const limit = sequence.indexOf(firstUnfinished(draft));
  const index = requested ? sequence.indexOf(requested) : -1;
  return index >= 0 && index <= limit ? requested! : sequence[limit];
}

/** The step before this one, or null on the welcome screen. */
export function previousStep(step: WizardStep, mode: GameMode | null): WizardStep | null {
  const sequence = wizardSequence(mode);
  const index = sequence.indexOf(step);
  return index > 0 ? sequence[index - 1] : null;
}

/** The step after this one (the closing screen after the last step). */
export function nextStep(step: WizardStep, mode: GameMode | null): WizardStep {
  const sequence = wizardSequence(mode);
  const index = sequence.indexOf(step);
  return sequence[Math.min(index + 1, sequence.length - 1)];
}

/** Position of a step among the screens, for comparing where the wizard moved. */
export function stepIndex(step: WizardStep, mode: GameMode | null): number {
  return wizardSequence(mode).indexOf(step);
}

/**
 * Marks a step finished. `first` is true only the first time, so coming back
 * and continuing again is not counted as another completion.
 */
export function completeStep(
  draft: WizardDraft,
  step: OnboardingStep,
): { draft: WizardDraft; first: boolean } {
  if (draft.done.includes(step)) return { draft, first: false };
  return { draft: { ...draft, done: [...draft.done, step] }, first: true };
}

/** A new branch suggests its own path again, so the path step has to be seen again. */
export function withIndustry(draft: WizardDraft, industry: IndustryKey): WizardDraft {
  if (draft.industry === industry) return draft;
  return {
    ...draft,
    industry,
    pathKey: null,
    done: draft.done.filter((step) => step !== "path"),
  };
}

export function withMode(draft: WizardDraft, mode: GameMode): WizardDraft {
  return draft.mode === mode ? draft : { ...draft, mode };
}

export function withPath(draft: WizardDraft, pathKey: string): WizardDraft {
  return draft.pathKey === pathKey ? draft : { ...draft, pathKey };
}

const STEP_VALUES = ["welcome", "mode", "industry", "path", "region", "milestone", "contact"] as const;

const draftSchema = z.object({
  mode: z.enum(["game", "tool"]).nullable().catch(null),
  industry: z.enum(INDUSTRY_KEYS).nullable().catch(null),
  pathKey: z.string().max(64).nullable().catch(null),
  done: z
    .array(z.string())
    .catch([])
    .transform((steps) =>
      [...new Set(steps)].filter((step): step is OnboardingStep =>
        (STEP_VALUES as readonly string[]).includes(step),
      ),
    ),
});

/** Reads a stored draft; anything broken or foreign falls back to an empty one. */
export function parseDraft(raw: string | null): WizardDraft {
  if (!raw) return EMPTY_DRAFT;
  try {
    const parsed = draftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_DRAFT;
  } catch {
    return EMPTY_DRAFT;
  }
}
