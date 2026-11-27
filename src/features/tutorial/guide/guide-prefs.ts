"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import type { GuideSection } from "../ui-map/types";
import { isGuideSection } from "../ui-map/types";

/**
 * The person's own settings of the guide (30.8), in user_settings:
 * `guide_offers` (false = "don't offer help again") and `guide_seen` (the
 * sections whose first visit was already met with the offer of a quick
 * look). Read and written through `/api/guide/prefs`, not with the rest of
 * the settings: until the migration of 30.8 is applied the columns are
 * missing and the app must not notice; the browser keeps the same in
 * localStorage.
 */

export type GuidePrefs = { offers: boolean; seen: GuideSection[] };
export type LoadedGuidePrefs = GuidePrefs & { loaded: boolean };
const DEFAULT_PREFS: GuidePrefs = { offers: true, seen: [] };

const localKey = (userId: string) => `gradus.guide.${userId}`;

function readLocal(userId: string): Partial<GuidePrefs> {
  try {
    const raw = window.localStorage.getItem(localKey(userId));
    const value = raw ? (JSON.parse(raw) as Partial<GuidePrefs>) : {};
    return {
      ...(typeof value.offers === "boolean" ? { offers: value.offers } : {}),
      ...(Array.isArray(value.seen) ? { seen: value.seen.filter(isGuideSection) } : {}),
    };
  } catch {
    return {};
  }
}

function writeLocal(userId: string, prefs: GuidePrefs) {
  try {
    window.localStorage.setItem(localKey(userId), JSON.stringify(prefs));
  } catch {
    // Private mode: the database keeps it.
  }
}

/** Merges the stored and the browser's: an offer turned off anywhere stays off, a seen section stays seen. */
export function mergePrefs(stored: Partial<GuidePrefs>, local: Partial<GuidePrefs>): GuidePrefs {
  return {
    offers: (stored.offers ?? true) && (local.offers ?? true),
    seen: [...new Set([...(stored.seen ?? []), ...(local.seen ?? [])])],
  };
}

export const guidePrefsKey = (userId: string) => ["account", userId, "guide-prefs"] as const;

export function useGuidePrefs(): LoadedGuidePrefs {
  const { user } = useSession();
  const { data } = useQuery({
    queryKey: guidePrefsKey(user.id),
    queryFn: async (): Promise<GuidePrefs> => {
      const local = readLocal(user.id);
      const response = await fetch("/api/guide/prefs", { cache: "no-store" }).catch(() => null);
      const stored = response?.ok ? ((await response.json().catch(() => null)) as Partial<GuidePrefs> | null) : null;
      return mergePrefs(
        {
          offers: typeof stored?.offers === "boolean" ? stored.offers : true,
          seen: Array.isArray(stored?.seen) ? stored.seen.filter(isGuideSection) : [],
        },
        local,
      );
    },
    staleTime: 5 * 60_000,
  });
  return data ? { ...data, loaded: true } : { ...DEFAULT_PREFS, loaded: false };
}

export function useSaveGuidePrefs() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    // Not a change of the user's data: the struggle watch does not count it as "saved".
    meta: { guide: true },
    mutationFn: async (patch: Partial<GuidePrefs>) => {
      const current = queryClient.getQueryData<GuidePrefs>(guidePrefsKey(user.id)) ?? DEFAULT_PREFS;
      const next: GuidePrefs = {
        offers: patch.offers ?? current.offers,
        seen: [...new Set([...current.seen, ...(patch.seen ?? [])])].slice(0, 40),
      };
      writeLocal(user.id, next);
      queryClient.setQueryData(guidePrefsKey(user.id), next);
      // Before the migration of 30.8 the browser's copy is all there is; nothing to tell the user.
      await fetch("/api/guide/prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offers: next.offers, seen: next.seen }),
      }).catch(() => null);
      return next;
    },
  });
}
