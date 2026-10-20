"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Whether an error page is on screen. The app's frame (outside the error
 * boundary) reads it to keep Jarvis away while the person deals with the error.
 */

let shown = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Marks an error page as shown while the calling component is mounted. */
export function useMarkErrorScreen(): void {
  useEffect(() => {
    shown += 1;
    emit();
    return () => {
      shown -= 1;
      emit();
    };
  }, []);
}

export function useErrorScreenShown(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => shown > 0,
    () => false,
  );
}
