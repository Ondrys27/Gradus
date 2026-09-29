"use client";

import { useSyncExternalStore } from "react";

/**
 * Confetti and card animations on/off, mirrored from `user_settings.animations_enabled`
 * (the source of truth) so non-React code such as the celebration can ask
 * synchronously. Independent of `prefers-reduced-motion`, which is honoured
 * separately wherever `useReducedMotion` is already used. Sign-out resets it.
 */
const listeners = new Set<() => void>();
let current = true;

export function isAnimationsEnabled(): boolean {
  return typeof window === "undefined" ? true : current;
}

export function applyAnimationsEnabled(enabled: boolean) {
  if (current === enabled) return;
  current = enabled;
  listeners.forEach((listener) => listener());
}

export function resetAnimationsPreference() {
  applyAnimationsEnabled(true);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAnimationsEnabled(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => true,
  );
}
