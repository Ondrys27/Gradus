"use client";

import { useEffect, useState } from "react";

let hydrated = false;

/**
 * True for components that are part of the server-rendered first paint.
 * An entrance animation there would ship the content at opacity 0 and keep it
 * invisible until the JavaScript runs, which is what makes a slow phone feel
 * slow (and what Lighthouse scores as late LCP). Anything mounted later, such
 * as the next page after a client-side navigation, gets `false` and animates.
 */
export function useIsFirstPaint(): boolean {
  const [firstPaint] = useState(() => !hydrated);
  useEffect(() => {
    hydrated = true;
  }, []);
  return firstPaint;
}
