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
