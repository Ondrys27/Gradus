"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether a celebration card is on screen, for what waits until it is
 * closed (the tutorial's choice comes after the onboarding celebration).
 */
let open = false;
const listeners = new Set<() => void>();

export function setCelebrationOpen(value: boolean) {
  if (open === value) return;
  open = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCelebrationOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  );
}
