/**
 * What the app tells the tutorial when the user did something no row in the
 * database records on its own: a task moved in the map, a frequency picked in
 * Settings → Jarvis. In memory for the tab; a step that waits on one counts it
 * only when it came after the step began.
 */

export const TUTORIAL_SIGNALS = ["taskMoved", "jarvisFrequency"] as const;
export type TutorialSignal = (typeof TUTORIAL_SIGNALS)[number];

const last = new Map<TutorialSignal, number>();
const listeners = new Set<(signal: TutorialSignal) => void>();

/** Called by the screens; costs nothing when no tutorial runs. */
export function emitTutorialSignal(signal: TutorialSignal, at: number = Date.now()) {
  last.set(signal, at);
  for (const listener of listeners) listener(signal);
}

/** Whether the signal came at or after `since` (ms). */
export function signalSince(signal: TutorialSignal, since: number): boolean {
  const at = last.get(signal);
  return at !== undefined && at >= since;
}

export function subscribeTutorialSignals(listener: (signal: TutorialSignal) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** For tests: forget every signal. */
export function resetTutorialSignals() {
  last.clear();
}
