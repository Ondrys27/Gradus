import type { TutorialSection, TutorialStep } from "./steps";
import type {
  DemoResolution,
  RunningMode,
  TutorialMode,
  TutorialOutcome,
  TutorialState,
} from "./types";

/**
 * The tutorial's rules, without React: which steps this account gets now,
 * where a tutorial picks up again after a reload or the next day, when the
 * next step may be taken, when Jarvis gives a hint and what is stored.
 */

/** A hands-on step gets its hint after this long without activity. */
export const HINT_AFTER_MS = 30_000;
/** Back within this long (a reload, a moment away): the tutorial just goes on; later Jarvis asks. */
export const RESUME_DIRECTLY_MS = 10 * 60_000;
/** How often a hands-on step looks whether it is done (besides after every change the app saves). */
export const CHECK_INTERVAL_MS = 3_000;

export type StepAccess = {
  /** Sections still locked in game mode: their place in the menu is shown, the section is not opened. */
  locked: ReadonlySet<TutorialSection>;
  /** Sections this account does not have at all (a worker without the right). */
  missing: ReadonlySet<TutorialSection>;
};

export type PlannedStep = TutorialStep & {
  /** Locked in game mode: only its menu item lights up, with what unlocks it. */
  locked: boolean;
};

/**
 * The steps as this account can take them now. Trying something in a locked
 * or missing section is left out (the tutorial never unlocks anything); a
 * look at a locked section stays, pointing at its place in the menu.
 */
export function planSteps(steps: readonly TutorialStep[], access: StepAccess): PlannedStep[] {
  return steps.flatMap((step) => {
    if (access.missing.has(step.section)) return [];
    const locked = access.locked.has(step.section);
    if (locked && step.action === "do") return [];
    return [{ ...step, locked }];
  });
}

/** What a locked step lights up: its section's menu item. */
export function highlightOf(step: PlannedStep): readonly string[] {
  return step.locked ? [`nav-${step.section}`] : step.highlight;
}

/** The address the step opens when it begins, or null to stay where the user is. */
export function navigationFor(step: PlannedStep, pathname: string): string | null {
  if (!step.path || step.locked) return null;
  if (step.path === "/app") return pathname === "/app" ? null : "/app";
  const [base, query] = step.path.split("?");
  if (pathname.startsWith(`${base}/`)) return null;
  if (pathname === base && !query) return null;
  return step.path;
}

/** A new tutorial of this mode; "none" is over the moment it is chosen. */
export function startState(mode: TutorialMode, now: Date, startedAt?: string): TutorialState {
  const at = now.toISOString();
  if (mode === "none") {
    return {
      mode,
      step: null,
      started_at: at,
      updated_at: at,
      finished_at: at,
      outcome: "skipped",
      demo: null,
    };
  }
  return {
    mode,
    step: null,
    started_at: startedAt ?? at,
    updated_at: at,
    finished_at: null,
    outcome: null,
    demo: null,
  };
}

/** The state once the user reached a step. */
export function atStep(state: TutorialState, key: string, now: Date): TutorialState {
  return { ...state, step: key, updated_at: now.toISOString() };
}

/** The state once the tutorial ended: walked to the end, or left on the way. */
export function endState(
  state: TutorialState,
  outcome: Exclude<TutorialOutcome, "skipped">,
  now: Date,
  demo: DemoResolution | null = state.demo,
): TutorialState {
  const at = now.toISOString();
  return { ...state, outcome, finished_at: at, updated_at: at, demo };
}

/** A tutorial that was started and has not ended. */
export function isRunning(state: TutorialState | null): state is TutorialState & { mode: RunningMode } {
  return !!state && state.mode !== "none" && !state.finished_at && !!state.started_at;
}

/** After a reload it simply goes on; after a longer while Jarvis offers to go on. */
export function resumeHow(state: TutorialState, now: Date): "direct" | "offer" {
  const last = Date.parse(state.updated_at ?? state.started_at ?? "");
  if (!Number.isFinite(last)) return "offer";
  return now.getTime() - last <= RESUME_DIRECTLY_MS ? "direct" : "offer";
}

/**
 * Where a tutorial picks up: the step it stopped at, or — when that step is
 * not offered any more (its section was locked, the account changed) — the
 * next one after it in the full order.
 */
export function resumeIndex(
  planned: readonly PlannedStep[],
  order: readonly TutorialStep[],
  key: string | null,
): number {
  if (!key || planned.length === 0) return 0;
  const exact = planned.findIndex((step) => step.key === key);
  if (exact >= 0) return exact;
  const position = order.findIndex((step) => step.key === key);
  if (position < 0) return 0;
  const later = planned.findIndex(
    (step) => order.findIndex((item) => item.key === step.key) > position,
  );
  return later >= 0 ? later : planned.length - 1;
}

/** Next opens a look at once, a hands-on step only once it is done (Skip step always works). */
export function canAdvance(step: TutorialStep, passed: boolean): boolean {
  return step.action === "look" || passed;
}

/** Jarvis gives the hint of a hands-on step after a while without activity. */
export function hintDue(step: TutorialStep, passed: boolean, idleSince: number, now: number) {
  return step.action === "do" && !passed && now - idleSince >= HINT_AFTER_MS;
}

/**
 * Whether Jarvis asks how to start: once onboarding is done (a worker on the
 * first visit), until a choice is stored or the former tour was walked.
 */
export function choiceDue(input: {
  state: TutorialState | null;
  tourCompletedAt: string | null;
  onboarded: boolean;
  worker: boolean;
}): boolean {
  if (input.state || input.tourCompletedAt) return false;
  return input.worker || input.onboarded;
}
