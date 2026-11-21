"use client";

import { useSyncExternalStore } from "react";
import type { ShowcaseParams } from "./params";

/**
 * What is on the showcase's canvas besides the app (step 27.4), shared by
 * the driver that moves things and the overlays that draw them: the fake
 * cursor, the caption, the guest's window, Grady's staged summary, the
 * countdown and the stage's state (also on `data-showcase-state` for the
 * recording script).
 */

export type StagePhase =
  | "idle"
  | "countdown"
  | "playing"
  | "paused"
  | "outro"
  | "ending"
  | "ended"
  | "failed";

export type StageState = {
  phase: StagePhase;
  countdown: number | null;
  cursor: { x: number; y: number; visible: boolean; pressed: boolean };
  /** Grows with every click, so each one gets its ripple. */
  click: { id: number; x: number; y: number };
  caption: string | null;
  /** The public page shown in the guest's window, or null. */
  guestUrl: string | null;
  summary: string | null;
  error: string | null;
  /**
   * The showcase is over: the app frame closes behind the end card, so
   * nothing asks the server any more once the stage is deleted.
   */
  curtain: boolean;
};

const INITIAL: StageState = {
  phase: "idle",
  countdown: null,
  cursor: { x: -100, y: -100, visible: false, pressed: false },
  click: { id: 0, x: 0, y: 0 },
  caption: null,
  guestUrl: null,
  summary: null,
  error: null,
  curtain: false,
};

let state: StageState = INITIAL;
const listeners = new Set<() => void>();

export const stage = {
  get: () => state,
  set(patch: Partial<StageState>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  },
  cursor(patch: Partial<StageState["cursor"]>) {
    stage.set({ cursor: { ...state.cursor, ...patch } });
  },
  clicked(x: number, y: number) {
    stage.set({ click: { id: state.click.id + 1, x, y } });
  },
  reset() {
    state = INITIAL;
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useStage<T>(select: (state: StageState) => T): T {
  return useSyncExternalStore(
    stage.subscribe,
    () => select(state),
    () => select(INITIAL),
  );
}

/** What /app/ukazka hands to the stage's host across the page change (this tab only). */
const CONFIG_KEY = "gradus.showcase";

export function writeShowcaseConfig(params: ShowcaseParams) {
  try {
    sessionStorage.setItem(CONFIG_KEY, JSON.stringify(params));
  } catch {
    /* private mode: the showcase starts from the address again */
  }
}

export function takeShowcaseConfig(): ShowcaseParams | null {
  try {
    const raw = sessionStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(CONFIG_KEY);
    const parsed = JSON.parse(raw) as ShowcaseParams;
    return parsed && typeof parsed === "object" && parsed.scenario ? parsed : null;
  } catch {
    return null;
  }
}

/** The stage asks the host to begin (the host is already mounted in the app frame). */
export const START_EVENT = "gradus:showcase-start";
