"use client";

import { useSyncExternalStore } from "react";

/**
 * What the Jarvis overlays tell each other, kept in memory for the browser
 * session: whether the guided tour is on screen, a request to start it again
 * (Settings → Help), and whether Jarvis already spoke up on his own in this
 * session (at most once).
 */
type State = {
  tourActive: boolean;
  /** Grows with every request to start the tour; the tour starts when it changes. */
  tourRequest: number;
  proactiveShown: boolean;
};

let state: State = { tourActive: false, tourRequest: 0, proactiveShown: false };
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export const jarvisOverlay = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setTourActive: (tourActive: boolean) => {
    if (state.tourActive !== tourActive) set({ tourActive });
  },
  requestTour: () => set({ tourRequest: state.tourRequest + 1 }),
  markProactiveShown: () => set({ proactiveShown: true }),
};

export function useJarvisOverlay<T>(select: (state: State) => T): T {
  return useSyncExternalStore(
    jarvisOverlay.subscribe,
    () => select(state),
    () => select({ tourActive: false, tourRequest: 0, proactiveShown: false }),
  );
}
