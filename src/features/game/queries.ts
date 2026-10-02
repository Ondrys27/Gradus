"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import {
  useCelebration,
  type CelebrationOptions,
} from "@/components/celebration/celebration-provider";
import { accountKeys, useSession } from "@/features/account/queries";
import { createClient } from "@/lib/supabase/client";
import { useFormatSettings } from "@/lib/use-format-settings";
import { parseAwardResult, parseGameState } from "./parse";
import { tierForLevel, type XpReason } from "./rules";
import { localized, type AwardResult, type GameMode, type GameState } from "./types";

export const gameKeys = {
  all: (userId: string) => ["game", userId] as const,
  state: (userId: string) => ["game", userId, "state"] as const,
  paths: ["game", "paths"] as const,
};

/** Mode, XP, level, streak and which sections are open, in one read. */
export function useGameState() {
  const { user } = useSession();
  return useQuery({
    queryKey: gameKeys.state(user.id),
    queryFn: async (): Promise<GameState> => {
      const { data, error } = await createClient().rpc("game_state");
      if (error) throw error;
      return parseGameState(data);
    },
    // Small; every award updates it right away and refetches it.
    staleTime: 30_000,
  });
}

/**
 * Plays the big moments an award brings, in order: the caller's own (a
 * milestone, a won deal), a section the milestone unlocked, a level-up with
 * what it unlocked, each new badge. Plain XP stays quiet; the top bar pulses.
 */
function useCelebrateAward() {
  const t = useTranslations("game");
  const locale = useLocale();
  const { celebrate } = useCelebration();
  return (result: AwardResult, own?: CelebrationOptions | null) => {
    // The caller's own moment (a milestone, a won deal) first, then what it led to.
    if (own) celebrate(own);
    for (const item of result.unlocks.filter((unlock) => unlock.source === "milestone")) {
      celebrate({
        title: t("unlocked.title"),
        subtitle: t("unlocked.subtitle", { name: localized(item.name, locale) }),
      });
    }
    if (result.leveledUp) {
      const names = result.unlocks
        .filter((item) => item.source === "level")
        .map((item) => localized(item.name, locale));
      celebrate({
        title: t("levelUp.title", { level: result.level }),
        subtitle: t(`tiers.${tierForLevel(result.level)}`),
        reward: names.length > 0 ? t("levelUp.unlocked", { items: names.join(", ") }) : undefined,
      });
    }
    for (const achievement of result.achievements) {
      celebrate({
        title: t("achievementEarned"),
        subtitle: localized(achievement.name, locale),
      });
    }
  };
}

export type AwardInput = {
  reason: XpReason;
  refId?: string;
  /** The big moment this action is, built from the result (e.g. to show the XP gained). */
  celebration?: (result: AwardResult) => CelebrationOptions | null;
};

/**
 * The only way XP is ever granted. The server decides the amount, checks that
 * `refId` is the caller's own real action and applies the daily caps; asking
 * twice for the same action is free (`awarded: false` the second time).
 * Without `refId` the newest not yet rewarded action of today is used.
 */
export function useAwardXp() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const celebrateAward = useCelebrateAward();
  return useMutation({
    mutationFn: async ({ reason, refId }: AwardInput) => {
      const { data, error } = await createClient().rpc("award_xp", {
        _reason: reason,
        _ref_id: refId,
      });
      if (error) throw error;
      return parseAwardResult(data);
    },
    onSuccess: (result, variables) => {
      if (result.awarded) {
        queryClient.setQueryData(gameKeys.state(user.id), (prev: GameState | undefined) =>
          prev
            ? { ...prev, totalXp: result.totalXp, level: result.level, streak: result.streak }
            : prev,
        );
      }
      celebrateAward(result, variables.celebration?.(result));
      void queryClient.invalidateQueries({ queryKey: gameKeys.state(user.id) });
    },
  });
}

/** Game or tool. Switching to game keeps open every section the account already uses. */
export function useSetGameMode() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (mode: GameMode) => {
      const { error } = await createClient().from("profiles").update({ mode }).eq("id", user.id);
      if (error) throw error;
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: accountKeys.profile(user.id) }),
        queryClient.invalidateQueries({ queryKey: gameKeys.all(user.id) }),
      ]),
  });
}

export type PathSummary = { key: string; industries: string[] };

/** The paths and which onboarding industries each one fits. */
export async function fetchPaths(): Promise<PathSummary[]> {
  const { data, error } = await createClient()
    .from("paths")
    .select("key, industries")
    .order("position");
  if (error) throw error;
  return data ?? [];
}

/** The path for an onboarding industry; the first (general) one when none lists it. */
export function pathForIndustry(paths: PathSummary[], industry: string): string | null {
  return (paths.find((path) => path.industries.includes(industry)) ?? paths[0])?.key ?? null;
}

/**
 * Copies a path's milestones and tasks to the account. Changing the path adds
 * the new steps; completed and started ones stay.
 */
export function useChoosePath() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (pathKey: string) => {
      const { error } = await createClient().rpc("choose_path", { _path_key: pathKey });
      if (error) throw error;
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["milestones", user.id] }),
        queryClient.invalidateQueries({ queryKey: gameKeys.all(user.id) }),
      ]),
  });
}

/** Marks an unlock as seen, clearing its "just unlocked" glow for good. */
export function useMarkUnlockSeen() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (key: string) => {
      const { error } = await createClient()
        .from("unlocks")
        .update({ seen_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("key", key)
        .is("seen_at", null);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: gameKeys.state(user.id) }),
  });
}

/** Whether today beat every earlier day on the phone. A check only; it awards nothing. */
export function useProspectingRecord() {
  const { timeZone } = useFormatSettings();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await createClient()
        .rpc("prospecting_record", { _timezone: timeZone })
        .single();
      if (error) throw error;
      return { isRecord: data.is_record, seconds: data.seconds };
    },
  });
}
