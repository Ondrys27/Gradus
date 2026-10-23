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

/**
 * For an overlay outside the error boundary (Jarvis's panel, the search
 * window, a menu, a sheet): closes it as soon as an error page is shown, so
 * nothing stays over the error page or keeps its buttons from a click.
 * `close` must be stable (a state setter or a useCallback). Returns whether
 * the error page is shown, for overlays that should not render meanwhile.
 */
export function useCloseOnErrorScreen(close: () => void): boolean {
  const shown = useErrorScreenShown();
  useEffect(() => {
    if (shown) close();
  }, [shown, close]);
  return shown;
}
