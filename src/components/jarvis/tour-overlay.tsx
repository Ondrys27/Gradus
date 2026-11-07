"use client";

import { useEffect, useState } from "react";
import { findFirstTarget, type Box, type Size } from "@/features/jarvis/tour";

/**
 * What the tutorial overlay (src/features/tutorial) measures on the live page:
 * the box of the element Jarvis talks about and the window's size.
 */

function sameBox(a: Box | null, b: Box | null) {
  if (!a || !b) return a === b;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

/**
 * The lit element's box, kept current while the page scrolls, resizes or
 * renders it later (a page that is still loading). Zero sizes never count.
 */
export function useTargetBox(targets: readonly string[]): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  const key = targets.join("|");
  useEffect(() => {
    const names = key ? key.split("|") : [];
    let element: HTMLElement | null = null;
    let frame = 0;
    const observer = new ResizeObserver(() => schedule());
    const measure = () => {
      frame = 0;
      const found = names.length ? findFirstTarget(names) : null;
      if (found !== element) {
        if (element) observer.unobserve(element);
        element = found;
        if (element) observer.observe(element);
      }
      const rect = element?.getBoundingClientRect();
      const next =
        rect && rect.width > 0 && rect.height > 0
          ? {
              top: Math.round(rect.top),
              left: Math.round(rect.left),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            }
          : null;
      setBox((current) => (sameBox(current, next) ? current : next));
    };
    function schedule() {
      if (!frame) frame = requestAnimationFrame(measure);
    }
    measure();
    observer.observe(document.documentElement);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    // The Jarvis button bobs and pages fill in; a slow re-measure keeps the light on it.
    const interval = window.setInterval(schedule, 500);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.clearInterval(interval);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [key]);
  return box;
}

export function useViewport(): Size {
  const [size, setSize] = useState<Size>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return size;
}
