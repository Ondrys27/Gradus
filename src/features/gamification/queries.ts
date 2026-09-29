"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { createClient } from "@/lib/supabase/client";
import { useFormatSettings } from "@/lib/use-format-settings";
import { SECTION_UNLOCK_KEYS, type LockableSection, type SectionUnlockRow, type XpKind, type XpSummary } from "./types";

export const xpKeys = {
  summary: (userId: string) => ["xp", userId, "summary"] as const,
};

export const unlockKeys = {
  sections: (userId: string) => ["unlocks", userId, "sections"] as const,
};

/** Total XP and the current streak, in the user's own time zone. */
export function useXpSummary() {
  const { user } = useSession();
  const { timeZone } = useFormatSettings();
  return useQuery({
    queryKey: xpKeys.summary(user.id),
    queryFn: async (): Promise<XpSummary> => {
      const { data, error } = await createClient()
        .rpc("xp_summary", { _timezone: timeZone })
        .single();
      if (error) throw error;
      return { totalXp: Number(data.total_xp), streak: data.streak };
    },
    // Cheap and small; other mutations invalidate it as soon as they award XP.
    staleTime: 30_000,
  });
}

/**
 * The only way XP is ever granted. `idempotencyKey` ties the award to the real
 * event (a task id, a deal id, a day…) so asking twice for the same one is
 * free: the database returns `awarded: false` the second time.
 */
export function useAwardXp() {
  const { user } = useSession();
  const { timeZone } = useFormatSettings();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, idempotencyKey }: { kind: XpKind; idempotencyKey: string }) => {
      const { data, error } = await createClient()
        .rpc("award_xp", { _kind: kind, _idempotency_key: idempotencyKey, _timezone: timeZone })
        .single();
      if (error) throw error;
      return { awarded: data.awarded, xp: data.xp, totalXp: Number(data.total_xp) };
    },
    onSuccess: (result) => {
      if (result.awarded) queryClient.setQueryData(xpKeys.summary(user.id), (prev: XpSummary | undefined) => ({
        totalXp: result.totalXp,
        streak: prev?.streak ?? 0,
      }));
      void queryClient.invalidateQueries({ queryKey: xpKeys.summary(user.id) });
    },
  });
}

/** Whether today beat every earlier day on the phone; awards XP once per record day. */
export function useProspectingRecord() {
  const { user } = useSession();
  const { timeZone } = useFormatSettings();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await createClient()
        .rpc("prospecting_record", { _timezone: timeZone })
        .single();
      if (error) throw error;
      return { awarded: data.awarded, seconds: data.seconds, xp: data.xp ?? 0 };
    },
    onSuccess: (result) => {
      if (result.awarded) void queryClient.invalidateQueries({ queryKey: xpKeys.summary(user.id) });
    },
  });
}

/** Checked after any action that could book a meeting; awards XP once at the tenth. */
export function useMeetingTenth() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await createClient().rpc("award_meeting_tenth").single();
      if (error) throw error;
      return { awarded: data.awarded, meetings: data.meetings, xp: data.xp ?? 0 };
    },
    onSuccess: (result) => {
      if (result.awarded) void queryClient.invalidateQueries({ queryKey: xpKeys.summary(user.id) });
    },
  });
}

/**
 * Cold Calling, Calendar, Finance and Workers: locked, progress towards them,
 * and whether they were unlocked but not opened yet. The database grants the
 * unlock itself the moment the real counts cross the threshold.
 */
export function useSectionUnlocks() {
  const { user } = useSession();
  return useQuery({
    queryKey: unlockKeys.sections(user.id),
    queryFn: async (): Promise<Record<LockableSection, SectionUnlockRow>> => {
      const { data, error } = await createClient().rpc("section_unlocks");
      if (error) throw error;
      const byKey = new Map((data as SectionUnlockRow[]).map((row) => [row.key, row]));
      const result = {} as Record<LockableSection, SectionUnlockRow>;
      for (const section of Object.keys(SECTION_UNLOCK_KEYS) as LockableSection[]) {
        const row = byKey.get(SECTION_UNLOCK_KEYS[section]);
        result[section] = row ?? {
          key: SECTION_UNLOCK_KEYS[section],
          unlocked: false,
          unlocked_at: null,
          seen_at: null,
          progress: 0,
          needed: 1,
        };
      }
      return result;
    },
    staleTime: 15_000,
  });
}

/** Marks a section as visited, clearing its "just unlocked" glow for good. */
export function useMarkSectionSeen() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (key: string) => {
      const { error } = await createClient()
        .from("unlocks")
        .update({ seen_at: new Date().toISOString() })
        .eq("key", key)
        .is("seen_at", null);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: unlockKeys.sections(user.id) }),
  });
}
