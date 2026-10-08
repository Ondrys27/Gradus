"use client";

import { useEffect, useRef } from "react";
import { track } from "./client";
import type { EventProps } from "./events";

type Screen = EventProps<"view_selected">["screen"];
type View = EventProps<"view_selected">["view"];

/** Records which view a screen shows: once when it opens, then on every switch. */
export function useViewTracking(screen: Screen, view: View) {
  const seen = useRef(false);
  useEffect(() => {
    track("view_selected", { screen, view, initial: !seen.current });
    seen.current = true;
  }, [screen, view]);
}
