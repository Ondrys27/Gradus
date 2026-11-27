/**
 * When the transition into a new block of the day may play (30.6). It plays
 * only for a boundary the user witnessed with the app open; while they type,
 * a dialog is open, the call timer runs, the tutorial or the showcase is on
 * or someone types in a live note, it waits, at most 5 minutes; then the
 * theme changes quietly. Pure, the browser gathers the state.
 */

export const TRANSITION_MAX_WAIT_MS = 5 * 60_000;
/** Typing = focus in a field and a key pressed within these 5 seconds. */
export const TYPING_QUIET_MS = 5_000;
/** A boundary seen later than this after it passed (a sleeping laptop, a hidden tab) was not witnessed. */
export const WITNESS_SLACK_MS = 90_000;

export type GateState = {
  focusInField: boolean;
  lastKeyAt: number | null;
  dialogOpen: boolean;
  timerRunning: boolean;
  tutorial: boolean;
  liveNoteTyping: boolean;
  showcase: boolean;
  hidden: boolean;
};

export type GateReason =
  | "typing"
  | "dialog"
  | "timer"
  | "tutorial"
  | "liveNote"
  | "showcase"
  | "hidden";

export function isTyping(state: Pick<GateState, "focusInField" | "lastKeyAt">, now: number): boolean {
  return state.focusInField && state.lastKeyAt !== null && now - state.lastKeyAt < TYPING_QUIET_MS;
}

/** The first reason to wait, or null when nothing stands in the way. */
export function gateReason(state: GateState, now: number): GateReason | null {
  if (state.showcase) return "showcase";
  if (state.hidden) return "hidden";
  if (state.tutorial) return "tutorial";
  if (state.timerRunning) return "timer";
  if (state.dialogOpen) return "dialog";
  if (isTyping(state, now)) return "typing";
  if (state.liveNoteTyping) return "liveNote";
  return null;
}

export type TransitionDecision = "play" | "wait" | "silent";

/**
 * For a block that began at `dueAt`: play now, keep waiting, or change the
 * theme quietly (waited 5 minutes already).
 */
export function transitionDecision(dueAt: number, now: number, state: GateState): TransitionDecision {
  if (now - dueAt >= TRANSITION_MAX_WAIT_MS) return "silent";
  return gateReason(state, now) ? "wait" : "play";
}

/**
 * Whether the user saw the boundary happen: the app checked shortly before
 * it and sees it shortly after (not a reopened app, not a laptop that slept
 * through it). `lastCheckAt` is the previous look at the clock.
 */
export function witnessed(boundaryAt: number, lastCheckAt: number | null, now: number): boolean {
  if (lastCheckAt === null) return false;
  return lastCheckAt < boundaryAt && boundaryAt <= now && now - lastCheckAt <= WITNESS_SLACK_MS + 60_000;
}
