"use client";

import { useSyncExternalStore } from "react";

/**
 * Sound on/off, mirrored from `user_settings.sound_enabled` (the source of truth)
 * so non-React code such as the celebration can ask synchronously.
 * The session provider pushes the value in; sign-out resets it.
 */
const listeners = new Set<() => void>();
let current = true;

export function isSoundEnabled(): boolean {
  return typeof window === "undefined" ? false : current;
}

export function applySoundEnabled(enabled: boolean) {
  if (current === enabled) return;
  current = enabled;
  listeners.forEach((listener) => listener());
}

export function resetSoundPreference() {
  applySoundEnabled(true);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSoundEnabled(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => true,
  );
}
