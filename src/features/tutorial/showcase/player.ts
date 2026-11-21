import type { ShowcaseStep } from "./types";

/**
 * The showcase's player without the DOM (step 27.4): walks the steps in
 * order, keeps the caption and when each one was on screen (for the .srt of
 * a recording), pauses and goes on (Space), stops (Esc) and reports a step
 * that could not be played. Playing time is what the viewer sees: a pause
 * does not count, so the captions' times match the video once the pause is
 * cut. The driver (dom-driver.ts) does the actual moving, clicking and
 * typing and waits through the player's control, so a pause holds it too.
 */

export type PlayerStatus = "idle" | "playing" | "paused" | "done" | "stopped" | "failed";

export type CaptionCue = { caption: string; start: number; end: number };

export type PlayerSnapshot = {
  status: PlayerStatus;
  index: number;
  total: number;
  caption: string | null;
  /** Key of the step that failed, with why. */
  error: { step: string; reason: string } | null;
};

/** Thrown inside the run when the showcase was stopped; never reported as a failure. */
export class ShowcaseStopped extends Error {
  constructor() {
    super("showcase stopped");
    this.name = "ShowcaseStopped";
  }
}

/** Thrown by the driver when a step cannot be played (its target never showed up). */
export class ShowcaseStepFailed extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ShowcaseStepFailed";
  }
}

export type PlayerControl = {
  /** Resolves after `ms` of playing time; a pause holds it, a stop rejects it. */
  sleep(ms: number): Promise<void>;
  /** Playing time so far, in ms. */
  elapsed(): number;
  /** Rejects when the showcase was stopped (checked between the driver's own steps). */
  check(): void;
};

export type StepRunner = (step: ShowcaseStep, control: PlayerControl) => Promise<void>;

export type PlayerOptions = {
  steps: readonly ShowcaseStep[];
  run: StepRunner;
  /** Wall clock in ms (Date.now in the browser, a fake one in tests). */
  now?: () => number;
  /** Waits `ms` of wall time (setTimeout in the browser). */
  wait?: (ms: number) => Promise<void>;
  onChange?: (snapshot: PlayerSnapshot) => void;
};

/** How finely a sleep looks at the pause and the stop. */
const TICK_MS = 50;

export type ShowcasePlayer = {
  play(): Promise<PlayerSnapshot>;
  pause(): void;
  resume(): void;
  /** Space: pause while playing, go on while paused. */
  toggle(): void;
  stop(): void;
  snapshot(): PlayerSnapshot;
  /** When each caption was on screen, in playing time. */
  cues(): CaptionCue[];
};

export function createShowcasePlayer(options: PlayerOptions): ShowcasePlayer {
  const now = options.now ?? (() => Date.now());
  const wait =
    options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const steps = options.steps;

  let status: PlayerStatus = "idle";
  let index = 0;
  let caption: string | null = null;
  let error: PlayerSnapshot["error"] = null;
  const cues: CaptionCue[] = [];
  let open: { caption: string; start: number } | null = null;

  // Playing time: wall time minus the time spent paused.
  let startedAt = 0;
  let pausedTotal = 0;
  let pausedAt: number | null = null;
  const elapsed = () => {
    if (status === "idle") return 0;
    const reference = pausedAt ?? now();
    return Math.max(0, reference - startedAt - pausedTotal);
  };

  const snapshot = (): PlayerSnapshot => ({
    status,
    index,
    total: steps.length,
    caption,
    error,
  });
  const changed = () => options.onChange?.(snapshot());

  const stopped = () => status === "stopped";
  const check = () => {
    if (stopped()) throw new ShowcaseStopped();
  };

  async function sleep(ms: number) {
    const until = elapsed() + Math.max(0, ms);
    for (;;) {
      check();
      const left = until - elapsed();
      if (left <= 0 && pausedAt === null) return;
      await wait(Math.min(TICK_MS, Math.max(1, left)));
    }
  }

  const control: PlayerControl = { sleep, elapsed, check };

  function closeCue() {
    if (!open) return;
    const end = elapsed();
    if (end > open.start) cues.push({ caption: open.caption, start: open.start, end });
    open = null;
  }

  function setCaption(next: string | null) {
    if (next === caption) return;
    closeCue();
    caption = next;
    if (next) open = { caption: next, start: elapsed() };
    changed();
  }

  async function play(): Promise<PlayerSnapshot> {
    if (status !== "idle") return snapshot();
    status = "playing";
    startedAt = now();
    changed();
    try {
      for (index = 0; index < steps.length; index += 1) {
        // A pause pressed between two steps holds the next one.
        await sleep(0);
        changed();
        const step = steps[index]!;
        if (step.kind === "caption") {
          setCaption(step.caption);
        } else if (step.kind === "wait" && !step.until && !step.gone) {
          await sleep(step.ms ?? 1000);
        } else {
          await options.run(step, control);
        }
        if (step.after) await sleep(step.after);
      }
      // Wait out a pause pressed on the last step before calling it done.
      await sleep(0);
      setCaption(null);
      status = "done";
    } catch (failure) {
      closeCue();
      caption = null;
      if (failure instanceof ShowcaseStopped || stopped()) {
        status = "stopped";
      } else {
        status = "failed";
        error = {
          step: steps[index]?.key ?? "?",
          reason: failure instanceof Error ? failure.message : String(failure),
        };
      }
    }
    if (pausedAt !== null) {
      pausedTotal += now() - pausedAt;
      pausedAt = null;
    }
    changed();
    return snapshot();
  }

  function pause() {
    if (status !== "playing") return;
    status = "paused";
    pausedAt = now();
    changed();
  }

  function resume() {
    if (status !== "paused") return;
    if (pausedAt !== null) pausedTotal += now() - pausedAt;
    pausedAt = null;
    status = "playing";
    changed();
  }

  return {
    play,
    pause,
    resume,
    toggle: () => (status === "paused" ? resume() : pause()),
    stop() {
      if (status === "done" || status === "failed" || status === "stopped") return;
      if (pausedAt !== null) {
        pausedTotal += now() - pausedAt;
        pausedAt = null;
      }
      status = "stopped";
      changed();
    },
    snapshot,
    cues: () => {
      const list = [...cues];
      if (open) list.push({ caption: open.caption, start: open.start, end: elapsed() });
      return list;
    },
  };
}
