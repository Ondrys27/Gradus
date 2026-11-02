"use client";

import { useSyncExternalStore } from "react";

/**
 * What the Jarvis overlays tell each other, kept in memory for the browser
 * session: whether the guided tour is on screen, a request to start it again
 * (Settings → Help), whether Jarvis already spoke up on his own in this
 * session (at most once besides the summary), and which of his callouts is
 * on screen (the summary, or a notice: a proactive card or the Notes
 * introduction), so none flies in over another.
 */
type State = {
  tourActive: boolean;
  /** Grows with every request to start the tour; the tour starts when it changes. */
  tourRequest: number;
  proactiveShown: boolean;
  summaryOpen: boolean;
  noticeOpen: boolean;
};

const INITIAL: State = {
  tourActive: false,
  tourRequest: 0,
  proactiveShown: false,
  summaryOpen: false,
  noticeOpen: false,
};

let state: State = INITIAL;
type NoticeSource = "proactive" | "notesIntro";
const openNotices = new Set<NoticeSource>();
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
  setSummaryOpen: (summaryOpen: boolean) => {
    if (state.summaryOpen !== summaryOpen) set({ summaryOpen });
  },
  /** One source (the proactive card, the Notes introduction) came on screen or left it. */
  setNoticeOpen: (source: NoticeSource, open: boolean) => {
    if (open) openNotices.add(source);
    else openNotices.delete(source);
    const noticeOpen = openNotices.size > 0;
    if (state.noticeOpen !== noticeOpen) set({ noticeOpen });
  },
};

export function useJarvisOverlay<T>(select: (state: State) => T): T {
  return useSyncExternalStore(
    jarvisOverlay.subscribe,
    () => select(state),
    () => select(INITIAL),
  );
}
