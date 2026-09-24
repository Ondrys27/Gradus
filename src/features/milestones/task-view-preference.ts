"use client";

import { useCallback, useSyncExternalStore } from "react";

export type TaskView = "list" | "map";

/**
 * List or map in the milestone detail. A per-device convenience, so it lives in
 * localStorage; when storage is unavailable the list is shown.
 */
const STORAGE_KEY = "gradus.milestones.taskView";
const listeners = new Set<() => void>();
/** This tab's choice, so the switch works even where storage throws. */
let chosen: TaskView | null = null;

function read(): TaskView {
  if (chosen) return chosen;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "map" ? "map" : "list";
  } catch {
    return "list";
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    chosen = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useTaskView(): [TaskView, (view: TaskView) => void] {
  const view = useSyncExternalStore(subscribe, read, () => "list" as const);
  const setView = useCallback((next: TaskView) => {
    chosen = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode or blocked storage: the choice just is not remembered.
    }
    listeners.forEach((listener) => listener());
  }, []);
  return [view, setView];
}
