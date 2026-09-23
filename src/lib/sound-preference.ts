"use client";

import { useSyncExternalStore } from "react";

/**
 * Sound on/off. Kept in the browser until `user_settings` exists;
 * then this module becomes the single place that reads it from there.
 */
const STORAGE_KEY = "gradus.sound";
const listeners = new Set<() => void>();
let current: boolean | null = null;

function read(): boolean {
  if (current === null) {
    try {
      current = window.localStorage.getItem(STORAGE_KEY) !== "off";
    } catch {
      current = true;
    }
  }
  return current;
}

export function isSoundEnabled(): boolean {
  return typeof window === "undefined" ? false : read();
}

export function setSoundEnabled(enabled: boolean) {
  current = enabled;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Storage blocked: the choice lasts until reload.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSoundEnabled(): boolean {
  return useSyncExternalStore(subscribe, read, () => true);
}
