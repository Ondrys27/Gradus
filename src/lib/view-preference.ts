"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A remembered choice of view (list or map…), per device in localStorage.
 * Every screen with a view switch gets its own hook from this; when storage is
 * unavailable the fallback is shown and the choice holds for the tab.
 */
export function createViewPreference<V extends string>(
  storageKey: string,
  values: readonly V[],
  fallback: V,
): () => [V, (view: V) => void] {
  const listeners = new Set<() => void>();
  /** This tab's choice, so the switch works even where storage throws. */
  let chosen: V | null = null;

  function read(): V {
    if (chosen) return chosen;
    try {
      const stored = window.localStorage.getItem(storageKey);
      return values.find((value) => value === stored) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      chosen = null;
      listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }

  return function useViewPreference(): [V, (view: V) => void] {
    const view = useSyncExternalStore(subscribe, read, () => fallback);
    const setView = useCallback((next: V) => {
      chosen = next;
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        // Private mode or blocked storage: the choice just is not remembered.
      }
      listeners.forEach((listener) => listener());
    }, []);
    return [view, setView];
  };
}
