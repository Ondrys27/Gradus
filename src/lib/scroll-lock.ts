"use client";

import { useEffect } from "react";

/**
 * The one page scroll lock for overlays that are not Base UI dialogs (the
 * guided tour, a dashboard tile's detail, the full-screen tree map, the
 * marketing menu). Base UI dialogs keep their own lock.
 *
 * The lock is a counter and an attribute on <html> (a stylesheet rule in
 * globals.css hides the body's overflow), never a saved-and-restored inline
 * style. Saving `body.style.overflow` and putting it back is what left the
 * page frozen: the tour started while the onboarding celebration (a Base UI
 * dialog) still held its lock, saved its "hidden", and put that back when it
 * ended, long after the celebration had let go. Until a reload nothing
 * scrolled. Base UI sees this lock through the computed style and waits for
 * it to clear before taking its own, so the two never overwrite each other.
 */
export const PAGE_LOCK_ATTRIBUTE = "data-page-scroll-locked";

let holders = 0;

function apply() {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  if (holders > 0) html.setAttribute(PAGE_LOCK_ATTRIBUTE, "");
  else html.removeAttribute(PAGE_LOCK_ATTRIBUTE);
}

/** Locks the page's scroll until the returned release is called (once; later calls do nothing). */
export function lockPageScroll(): () => void {
  holders += 1;
  apply();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    apply();
  };
}

/** How many overlays hold the lock right now. */
export function pageScrollLockCount() {
  return holders;
}

/** Holds the page's scroll lock while `active` and the component is mounted. */
export function usePageScrollLock(active = true) {
  useEffect(() => (active ? lockPageScroll() : undefined), [active]);
}

/** Any dialog on screen, which may hold a lock of its own. */
function dialogOpen() {
  return [...document.querySelectorAll<HTMLElement>("[role='dialog'], [role='alertdialog']")].some(
    (element) => element.getClientRects().length > 0,
  );
}

/**
 * The safety net after a page change: with no overlay holding the lock and no
 * dialog on screen, nothing may keep the page from scrolling or being
 * clicked. Clears whatever a lock left behind on <html> and <body>; returns
 * whether it had to.
 */
export function releaseStrayPageLock(): boolean {
  if (typeof document === "undefined" || holders > 0 || dialogOpen()) return false;
  let cleared = false;
  for (const element of [document.documentElement, document.body]) {
    for (const property of ["overflow", "overflow-x", "overflow-y", "pointer-events"]) {
      const value = element.style.getPropertyValue(property);
      if (value === "hidden" || value === "clip" || value === "none") {
        element.style.removeProperty(property);
        cleared = true;
      }
    }
  }
  if (document.documentElement.hasAttribute(PAGE_LOCK_ATTRIBUTE)) {
    document.documentElement.removeAttribute(PAGE_LOCK_ATTRIBUTE);
    cleared = true;
  }
  return cleared;
}
