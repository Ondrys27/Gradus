"use client";

import type { ScheduleBlock } from "./schedule";

/**
 * Settings → Appearance asks the app frame to play the transition into a
 * block now ("Preview the transition"); AppearanceSync plays it and then
 * returns to the current theme.
 */
type Listener = (block: Pick<ScheduleBlock, "name" | "caption" | "start" | "theme">) => void;

const listeners = new Set<Listener>();

export const transitionPreview = {
  request(block: Pick<ScheduleBlock, "name" | "caption" | "start" | "theme">) {
    for (const listener of listeners) listener(block);
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
