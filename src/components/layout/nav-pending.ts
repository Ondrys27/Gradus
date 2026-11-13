"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

/**
 * The menu item the user just clicked while its page is still on the way
 * from the server. The menu marks it active at once and the content dims
 * slightly, so a click always answers immediately; nothing spins.
 */
let pendingHref: string | null = null;
let safety: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

/** Give up on a navigation that never lands (offline, an error page). */
export const NAV_PENDING_TIMEOUT_MS = 10_000;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The path of a menu address without its query or hash. */
export function pathOf(href: string): string {
  const end = href.search(/[?#]/);
  const path = end === -1 ? href : href.slice(0, end);
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/** Only a change of page waits on the server; the page already shown never does. */
export function shouldMarkPending(currentPath: string, href: string): boolean {
  return pathOf(currentPath) !== pathOf(href);
}

export function markNavigating(currentPath: string, href: string) {
  if (!shouldMarkPending(currentPath, href)) return;
  pendingHref = pathOf(href);
  if (safety) clearTimeout(safety);
  safety = setTimeout(clearNavigating, NAV_PENDING_TIMEOUT_MS);
  emit();
}

export function clearNavigating() {
  if (safety) clearTimeout(safety);
  safety = null;
  if (pendingHref === null) return;
  pendingHref = null;
  emit();
}

/** The address the user is going to, or null when nothing is on the way. */
export function readPendingHref(): string | null {
  return pendingHref;
}

export function usePendingHref(): string | null {
  return useSyncExternalStore(subscribe, readPendingHref, () => null);
}

/** Ends the pending state as soon as the new page is the current one. */
export function useClearNavigatingOnArrival() {
  const pathname = usePathname();
  useEffect(() => {
    clearNavigating();
  }, [pathname]);
}
