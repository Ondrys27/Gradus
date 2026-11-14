"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ADMIN_HIGHLIGHT_EVENT } from "../help-index";

/** Classes of the highlight ring; listed here so Tailwind generates them. */
const RING = ["ring-2", "ring-violet", "ring-offset-4", "ring-offset-canvas", "rounded-2xl"] as const;
const SHOW_MS = 2400;
/** Streamed blocks of a page come later than the page; the element is looked for a while. */
const LOOK_MS = 5000;
const STEP_MS = 150;

/**
 * Where ⌘K or the Help page sent you: the element named by the address's
 * anchor (#ai-caps) scrolls into view and glows for a moment. Runs after
 * every navigation and when ⌘K asks again for the page already open.
 */
export function AdminAnchorHighlight() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const again = () => setTick((value) => value + 1);
    window.addEventListener(ADMIN_HIGHLIGHT_EVENT, again);
    window.addEventListener("hashchange", again);
    return () => {
      window.removeEventListener(ADMIN_HIGHLIGHT_EVENT, again);
      window.removeEventListener("hashchange", again);
    };
  }, []);

  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id || !/^[a-z0-9-]{1,60}$/.test(id)) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const started = Date.now();
    let removeTimer = 0;
    let lit: HTMLElement | null = null;
    const look = window.setInterval(() => {
      const element = document.getElementById(id);
      if (!element && Date.now() - started < LOOK_MS) return;
      window.clearInterval(look);
      if (!element) return;
      element.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
      element.classList.add(...RING);
      element.setAttribute("data-admin-highlight", "");
      lit = element;
      removeTimer = window.setTimeout(() => {
        element.classList.remove(...RING);
        element.removeAttribute("data-admin-highlight");
        lit = null;
      }, SHOW_MS);
    }, STEP_MS);
    return () => {
      window.clearInterval(look);
      window.clearTimeout(removeTimer);
      lit?.classList.remove(...RING);
      lit?.removeAttribute("data-admin-highlight");
    };
  }, [pathname, search, tick]);

  return null;
}
