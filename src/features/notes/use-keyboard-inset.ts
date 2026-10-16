"use client";

import { useEffect, useState } from "react";

/**
 * How far the on-screen keyboard covers the bottom of the layout viewport, in
 * px (0 without one). A bar placed `bottom: inset` sits right above the
 * keyboard on iOS and Android, where fixed elements otherwise hide behind it.
 */
export function useKeyboardInset(active: boolean): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = typeof window !== "undefined" ? window.visualViewport : null;
    if (!active || !viewport) {
      setInset(0);
      return;
    }
    const update = () => {
      const covered = window.innerHeight - viewport.height - viewport.offsetTop;
      setInset(Math.max(0, Math.round(covered)));
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [active]);

  return inset;
}
