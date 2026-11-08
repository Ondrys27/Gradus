"use client";

import { useCallback, useEffect, useState } from "react";
import { currentSpaceCookie, loadedSpace } from "@/lib/supabase/client";
import { pathAfterSwitch } from "./spaces";

export type SwitchState = "idle" | "switching" | "failed";

/**
 * Switches the active space: the server checks the membership and sets the
 * cookie, then the app loads again in the same section (or the dashboard
 * when it is not open there). A full load on purpose: every cached list,
 * every live channel and the session snapshot start over in the new space,
 * so nothing of the other company stays on screen.
 */
export function useSwitchSpace() {
  const [state, setState] = useState<SwitchState>("idle");
  const switchTo = useCallback(async (space: string) => {
    setState("switching");
    try {
      const response = await fetch("/api/space", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ space }),
      });
      if (!response.ok) throw new Error(`switch ${response.status}`);
      window.location.assign(pathAfterSwitch(window.location.pathname));
    } catch {
      setState("failed");
    }
  }, []);
  return { state, switchTo };
}

/**
 * Another tab switched the space: this tab still shows the old one, while
 * the server (cookie) would already act in the new one. Back on this tab it
 * loads again, so a tab never mixes two companies.
 */
export function SpaceTabSync() {
  useEffect(() => {
    // Remembered now, as the page loaded with it.
    loadedSpace();
    const check = () => {
      if (document.visibilityState !== "visible") return;
      if (currentSpaceCookie() !== loadedSpace()) window.location.reload();
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, []);
  return null;
}
