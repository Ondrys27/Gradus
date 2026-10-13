"use client";

import { useSyncExternalStore } from "react";

/** Matches the phone layout: below Tailwind's `md` breakpoint (768 px). */
export const PHONE_QUERY = "(max-width: 767.98px)";

/** Live result of a CSS media query. On the server and during hydration it is `false`. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_QUERY);
}

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * The OS asks for less motion. Use instead of framer-motion's
 * useReducedMotion in anything the server renders: that one already knows the
 * answer on the browser's first render, so a branch on it (an element shown
 * only with motion) made the hydration fail for people with reduced motion.
 * This one is false on the server and during hydration, then follows the OS.
 */
export function useReducedMotionSafe(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY);
}
