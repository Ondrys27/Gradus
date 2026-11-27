"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { track } from "@/lib/analytics/client";
import { EMPTY_NAV_PREFS, isDefaultNavPrefs, parseNavPrefs, type NavPrefs } from "./nav-prefs";

/**
 * The person's own menu (30.9): pinned, hidden and reordered sections, in
 * `user_settings.nav_prefs`. Read and written through `/api/nav-prefs`
 * rather than with the rest of the settings: until the migration of 30.9 is
 * applied the column is missing and the app must not notice; the browser
 * keeps the same in localStorage, so the menu is right from the first paint
 * after hydration and survives a server that does not store it yet.
 */

const localKey = (userId: string) => `gradus.nav.${userId}`;

function readLocal(userId: string): NavPrefs | null {
  try {
    const raw = window.localStorage.getItem(localKey(userId));
    return raw ? parseNavPrefs(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeLocal(userId: string, prefs: NavPrefs) {
  try {
    window.localStorage.setItem(localKey(userId), JSON.stringify(prefs));
  } catch {
    // Private mode: the database keeps it.
  }
}

export const navPrefsKey = (userId: string) => ["account", userId, "nav-prefs"] as const;

/** The stored menu; the default until it is known (the menu never waits on the network). */
export function useNavPrefs(): NavPrefs {
  const { user } = useSession();
  // The browser's copy only after hydration: the first client render must match the server's.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { data } = useQuery({
    queryKey: navPrefsKey(user.id),
    queryFn: async (): Promise<NavPrefs> => {
      const response = await fetch("/api/nav-prefs", { cache: "no-store" }).catch(() => null);
      const stored = response?.ok
        ? ((await response.json().catch(() => null)) as (NavPrefs & { stored?: boolean }) | null)
        : null;
      // The database wins once it has the row; the browser's copy stands in before the migration.
      if (stored?.stored) {
        const prefs = parseNavPrefs(stored);
        writeLocal(user.id, prefs);
        return prefs;
      }
      return readLocal(user.id) ?? EMPTY_NAV_PREFS;
    },
    // The browser's copy shows at once, so a customised menu does not flash into place.
    placeholderData: () => (mounted ? (readLocal(user.id) ?? undefined) : undefined),
    staleTime: 5 * 60_000,
  });
  return data ?? EMPTY_NAV_PREFS;
}

export function useSaveNavPrefs() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    // Not a change of the user's data: the struggle watch does not count it as "saved".
    meta: { guide: true },
    mutationFn: async (next: NavPrefs) => {
      const prefs = parseNavPrefs(next);
      writeLocal(user.id, prefs);
      queryClient.setQueryData(navPrefsKey(user.id), prefs);
      track("settings_changed", { setting: "menu", enabled: !isDefaultNavPrefs(prefs) });
      await fetch("/api/nav-prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      }).catch(() => null);
      return prefs;
    },
  });
}
