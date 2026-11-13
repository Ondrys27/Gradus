"use client";

import type { QueryClient } from "@tanstack/react-query";
import { resetAnimationsPreference } from "@/lib/animation-preference";
import { resetSoundPreference } from "@/lib/sound-preference";
import { loginPath } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/client";

/**
 * Forgets everything the signed-in user left in this tab. Every caller leaves
 * the page right after (replace or reload), which drops the in-memory query
 * cache with it; emptying the cache here would re-render the app with no
 * profile or settings for a moment and crash the readers that rely on them.
 */
export function clearClientState(queryClient: QueryClient) {
  queryClient.cancelQueries();
  resetSoundPreference();
  resetAnimationsPreference();
  try {
    window.sessionStorage.clear();
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("gradus.") || key.startsWith("sb-")) window.localStorage.removeItem(key);
    }
  } catch {
    // Storage blocked: nothing was stored there either.
  }
}

/**
 * Signs out on this device, wipes client state and reloads into the login page
 * so no in-memory state of the previous user survives.
 */
export async function signOutEverywhereInTab(queryClient: QueryClient, target?: string) {
  try {
    await createClient().auth.signOut({ scope: "local" });
  } finally {
    clearClientState(queryClient);
    window.location.replace(target ?? loginPath(document.documentElement.lang));
  }
}
