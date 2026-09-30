"use client";

import { useSyncExternalStore } from "react";

function detectMac(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** Whether shortcuts read ⌘ (Apple) or Ctrl. False on the server and during hydration. */
export function useIsMac(): boolean {
  return useSyncExternalStore(
    () => () => {},
    detectMac,
    () => false,
  );
}
