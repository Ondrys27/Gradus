"use client";

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import {
  useCelebration,
  type CelebrationOptions,
} from "@/components/celebration/celebration-provider";
import { accountKeys, useProfile, useSession } from "@/features/account/queries";
import { track } from "@/lib/analytics/client";
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
 * Whether the account plays the game: an owner in game mode. Read from the
 * profile the app layout loaded, so it is known on the first render. A worker
 * has no game of their own.
 */
export function useIsPlaying(): boolean {
  const { worker } = useSession();
  const profile = useProfile();
  return !worker && profile.mode !== "tool";
}

/** Which big moment a celebration is; tool mode keeps only a milestone and a win. */
export type CelebrationMoment = "milestone" | "win" | "other";

/**
 * celebrate() that knows the mode: in tool mode only a finished milestone
 * and a won deal are celebrated, and never with XP.
 */
export function useGameCelebrate() {
  const { celebrate } = useCelebration();
  const toolMode = useProfile().mode === "tool";
  return useCallback(
    (
      options: CelebrationOptions,
      moment: CelebrationMoment = "other",
      kind: CelebrationKind = moment,
    ) => {
      if (!toolMode) {
        track("celebration_shown", { kind, quiet: false });
        celebrate(options);
        return;
      }
      if (moment === "other") return;
      track("celebration_shown", { kind, quiet: true });
      celebrate({ title: options.title, subtitle: options.subtitle, reward: options.reward });
    },
    [celebrate, toolMode],
  );
}

/** What a celebration was for, as analytics counts them. */
type CelebrationKind = CelebrationMoment | "level" | "achievement" | "unlock";

/**
 * Plays the big moments an award brings, in order: the caller's own (a
 * milestone, a won deal), a section the milestone unlocked, a level-up with
 * what it unlocked, each new badge. Plain XP stays quiet; the top bar pulses.
 */
function useCelebrateAward() {
  const t = useTranslations("game");
  const locale = useLocale();
  const celebrate = useGameCelebrate();
  return (result: AwardResult, own?: CelebrationOptions | null, moment?: CelebrationMoment) => {
    // The caller's own moment (a milestone, a won deal) first, then what it led to.
    if (own) celebrate(own, moment);
    for (const item of result.unlocks.filter((unlock) => unlock.source === "milestone")) {
      celebrate(
        {
          title: t("unlocked.title"),
          subtitle: t("unlocked.subtitle", { name: localized(item.name, locale) }),
        },
        "other",
        "unlock",
      );
    }
    if (result.leveledUp) {
      celebrate(
        {
          title: t("levelUp.title", { level: result.level }),
          subtitle: t(`tiers.${tierForLevel(result.level)}`),
          level: result.level,
          rewards: result.unlocks
            .filter((item) => item.source === "level")
            .map((item) => ({
              key: item.key,
              name: localized(item.name, locale),
              description: localized(item.description, locale),
              icon: item.icon,
            })),
        },
        "other",
        "level",
      );
    }
    for (const achievement of result.achievements) {
      celebrate(
        {
          title: t("achievementEarned"),
          subtitle: localized(achievement.name, locale),
        },
        "other",
        "achievement",
      );
    }
  };
}

/** What an award brought, as events: XP, a new level, badges and unlocks. */
function trackAward(result: AwardResult) {
  if (!result.awarded) return;
  track("xp_awarded", {
    reason: result.reason,
    xp: Math.max(0, result.xp),
    level: result.level,
    total_xp: Math.max(0, result.totalXp),
    streak: Math.max(0, result.streak),
  });
  if (result.leveledUp) track("level_reached", { level: result.level });
  for (const achievement of result.achievements) {
    track("achievement_earned", { achievement: achievement.key });
  }
  for (const unlock of result.unlocks) {
    track("section_unlocked", { unlock: unlock.key, source: unlock.source });
  }
}

export type AwardInput = {
  reason: XpReason;
  refId?: string;
  /** The big moment this action is, built from the result (e.g. to show the XP gained). */
  celebration?: (result: AwardResult) => CelebrationOptions | null;
  /** Which moment the celebration is, so tool mode can keep it or drop it. */
  moment?: CelebrationMoment;
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
      trackAward(result);
      if (result.awarded) {
        queryClient.setQueryData(gameKeys.state(user.id), (prev: GameState | undefined) =>
          prev
            ? { ...prev, totalXp: result.totalXp, level: result.level, streak: result.streak }
            : prev,
        );
      }
      celebrateAward(result, variables.celebration?.(result), variables.moment);
      // State, path progress, today's XP and the history all follow an award.
      void queryClient.invalidateQueries({ queryKey: gameKeys.all(user.id) });
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
      track("game_mode_changed", { to: mode, where: "settings" });
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
      track("path_chosen", { path: pathKey, where: "settings" });
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
