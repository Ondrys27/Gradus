"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountKeys, useProfile, useSession } from "@/features/account/queries";
import { dayRangeToInstants } from "@/features/calendar/calendar-logic";
import { todayIsoDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useFormatSettings } from "@/lib/use-format-settings";
import type { Profile } from "@/features/account/types";
import { countOpenTasks, type FocusMilestone } from "./overview";
import {
  buildPathProgress,
  type OwnedStep,
  type PathProgress,
  type TemplateStep,
} from "./path-progress";
import { gameKeys, useGameState } from "./queries";
import type { LocalizedText, UnlockKind } from "./types";

/** Definitions change only with a migration; read once per session. */
const DEFINITIONS_STALE = Infinity;
/** A user has a dozen path milestones; this only bounds the query. */
const OWNED_LIMIT = 200;
/** Today's XP events: every source is capped, so a day holds well under this. */
const TODAY_LIMIT = 500;
const HISTORY_LIMIT = 10;

export const overviewKeys = {
  definitions: ["game", "definitions"] as const,
  templates: ["game", "templates"] as const,
  paths: ["game", "path-list"] as const,
  owned: (userId: string) => ["game", userId, "owned-steps"] as const,
  overview: (userId: string, day: string) => ["game", userId, "overview", day] as const,
  focus: (userId: string, milestoneId: string) => ["game", userId, "focus", milestoneId] as const,
};

function asText(value: unknown): LocalizedText {
  const o = (value ?? {}) as Partial<LocalizedText>;
  return { en: String(o.en ?? ""), cs: String(o.cs ?? "") };
}

export type UnlockDefinition = {
  key: string;
  kind: UnlockKind;
  name: LocalizedText;
  description: LocalizedText;
  icon: string;
};

export type Definitions = {
  unlocks: Map<string, UnlockDefinition>;
  /** Level → what it unlocks, in the order of the definitions. */
  levelRewards: Map<number, UnlockDefinition[]>;
};

/** Every unlockable thing and the level rewards. */
export function useDefinitions() {
  return useQuery({
    queryKey: overviewKeys.definitions,
    staleTime: DEFINITIONS_STALE,
    queryFn: async (): Promise<Definitions> => {
      const supabase = createClient();
      const [unlocks, rewards] = await Promise.all([
        supabase
          .from("unlock_definitions")
          .select("key, kind, name, description, icon")
          .order("position")
          .limit(200),
        supabase.from("level_rewards").select("level, unlock_key").order("level").limit(200),
      ]);
      if (unlocks.error) throw unlocks.error;
      if (rewards.error) throw rewards.error;
      const map = new Map<string, UnlockDefinition>(
        unlocks.data.map((row) => [
          row.key,
          {
            key: row.key,
            kind: row.kind as UnlockKind,
            name: asText(row.name),
            description: asText(row.description),
            icon: row.icon,
          },
        ]),
      );
      const levelRewards = new Map<number, UnlockDefinition[]>();
      for (const row of rewards.data) {
        const definition = map.get(row.unlock_key);
        if (!definition) continue;
        levelRewards.set(row.level, [...(levelRewards.get(row.level) ?? []), definition]);
      }
      return { unlocks: map, levelRewards };
    },
  });
}

export type PathSummaryFull = {
  key: string;
  name: LocalizedText;
  description: LocalizedText;
  icon: string;
  industries: string[];
};

/** The paths with their names, for onboarding and Settings. */
export function usePathList() {
  return useQuery({
    queryKey: overviewKeys.paths,
    staleTime: DEFINITIONS_STALE,
    queryFn: async (): Promise<PathSummaryFull[]> => {
      const { data, error } = await createClient()
        .from("paths")
        .select("key, name, description, icon, industries")
        .order("position")
        .limit(50);
      if (error) throw error;
      return data.map((row) => ({
        key: row.key,
        name: asText(row.name),
        description: asText(row.description),
        icon: row.icon,
        industries: row.industries,
      }));
    },
  });
}

/** Every path's steps (a few dozen rows), shared by the map, the window and the preview. */
export function usePathTemplates() {
  return useQuery({
    queryKey: overviewKeys.templates,
    staleTime: DEFINITIONS_STALE,
    queryFn: async (): Promise<TemplateStep[]> => {
      const { data, error } = await createClient()
        .from("path_milestones")
        .select("id, key, path_key, chapter, position, title, xp, unlock_key")
        .order("path_key")
        .order("chapter")
        .order("position")
        .limit(500);
      if (error) throw error;
      return data.map((row) => ({
        id: row.id,
        key: row.key,
        pathKey: row.path_key,
        chapter: row.chapter,
        position: row.position,
        title: asText(row.title),
        xp: row.xp,
        unlockKey: row.unlock_key,
      }));
    },
  });
}

/** The chosen path with the user's progress on it; null without a path. */
export function usePathProgress(): { data: PathProgress | null; isPending: boolean } {
  const { user } = useSession();
  const game = useGameState();
  const templates = usePathTemplates();
  const pathKey = game.data?.pathKey ?? null;
  const owned = useQuery({
    queryKey: overviewKeys.owned(user.id),
    enabled: !!pathKey,
    queryFn: async (): Promise<OwnedStep[]> => {
      const { data, error } = await createClient()
        .from("milestones")
        .select("id, title, template_id, completed_at")
        .eq("user_id", user.id)
        .not("template_id", "is", null)
        .order("position")
        .limit(OWNED_LIMIT);
      if (error) throw error;
      return data.map((row) => ({
        id: row.id,
        templateId: row.template_id!,
        title: row.title,
        completed: row.completed_at !== null,
      }));
    },
  });
  if (!pathKey) return { data: null, isPending: game.isPending };
  if (!templates.data || !owned.data) return { data: null, isPending: true };
  return { data: buildPathProgress(pathKey, templates.data, owned.data), isPending: false };
}

export type XpHistoryItem = { id: string; kind: string; xp: number; createdAt: string };

export type Achievement = {
  key: string;
  name: LocalizedText;
  description: LocalizedText;
  icon: string;
  earnedAt: string | null;
};

export type LevelOverview = {
  today: { kind: string; xp: number }[];
  history: XpHistoryItem[];
  achievements: Achievement[];
};

/** What the level window reads when it opens: today's XP, the last events and the badges. */
export function useLevelOverview(enabled: boolean) {
  const { user } = useSession();
  const settings = useFormatSettings();
  const today = todayIsoDate(settings);
  return useQuery({
    queryKey: overviewKeys.overview(user.id, today),
    enabled,
    queryFn: async (): Promise<LevelOverview> => {
      const supabase = createClient();
      const day = dayRangeToInstants(today, today, settings.timeZone);
      const [todayRows, history, achievements, earned] = await Promise.all([
        supabase
          .from("xp_events")
          .select("kind, xp")
          .eq("user_id", user.id)
          .gte("created_at", day.from)
          .lt("created_at", day.to)
          .limit(TODAY_LIMIT),
        supabase
          .from("xp_events")
          .select("id, kind, xp, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(HISTORY_LIMIT),
        supabase
          .from("achievements")
          .select("key, name, description, icon")
          .order("position")
          .limit(100),
        supabase
          .from("user_achievements")
          .select("achievement_key, earned_at")
          .eq("user_id", user.id)
          .limit(100),
      ]);
      for (const result of [todayRows, history, achievements, earned]) {
        if (result.error) throw result.error;
      }
      const earnedAt = new Map(
        (earned.data ?? []).map((row) => [row.achievement_key, row.earned_at]),
      );
      return {
        today: todayRows.data ?? [],
        history: (history.data ?? []).map((row) => ({
          id: row.id,
          kind: row.kind,
          xp: row.xp,
          createdAt: row.created_at,
        })),
        achievements: (achievements.data ?? []).map((row) => ({
          key: row.key,
          name: asText(row.name),
          description: asText(row.description),
          icon: row.icon,
          earnedAt: earnedAt.get(row.key) ?? null,
        })),
      };
    },
  });
}

/**
 * The milestone the suggestions point at, with its open tasks and whether
 * completing it still pays XP (template XP is paid once per step, a custom
 * milestone once per milestone).
 */
export function useFocusMilestone(
  target: { id: string; title: string; templateId: string | null; xp: number } | null,
  enabled: boolean,
) {
  const { user } = useSession();
  return useQuery({
    queryKey: overviewKeys.focus(user.id, target?.id ?? "none"),
    enabled: enabled && !!target,
    queryFn: async (): Promise<FocusMilestone> => {
      const supabase = createClient();
      const keys = [target!.id, ...(target!.templateId ? [`template:${target!.templateId}`] : [])];
      const [tasks, paid] = await Promise.all([
        supabase
          .from("tasks")
          .select("parent_task_id, status")
          .eq("user_id", user.id)
          .eq("milestone_id", target!.id)
          .limit(2000),
        supabase
          .from("xp_events")
          .select("id")
          .eq("user_id", user.id)
          .eq("kind", "milestone_completed")
          .in("idempotency_key", keys)
          .limit(1),
      ]);
      if (tasks.error) throw tasks.error;
      if (paid.error) throw paid.error;
      return {
        id: target!.id,
        title: target!.title,
        xp: target!.xp,
        paysXp: paid.data.length === 0,
        ...countOpenTasks(tasks.data),
      };
    },
  });
}

/** The first active milestone, for the suggestions when there is no path step to point at. */
export function useFirstActiveMilestone(enabled: boolean) {
  const { user } = useSession();
  return useQuery({
    queryKey: [...gameKeys.all(user.id), "first-active"],
    enabled,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("milestones")
        .select("id, title, template_id")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("position")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/** The pill stops pulsing once the window has shown the current level. */
export function useMarkLevelSeen() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const key = accountKeys.profile(user.id);
  return useMutation({
    mutationFn: async (level: number) => {
      const { error } = await createClient()
        .from("profiles")
        .update({ seen_level: level })
        .eq("id", user.id);
      if (error) throw error;
    },
    onMutate: (level) => {
      const previous = queryClient.getQueryData<Profile>(key);
      if (previous) queryClient.setQueryData<Profile>(key, { ...previous, seen_level: level });
      return { previous };
    },
    onError: (_error, _level, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
  });
}

/** Whether the level pill should pulse: a level reached that the window has not shown yet. */
export function useLevelUnseen(level: number): boolean {
  const profile = useProfile();
  return level > (profile.seen_level ?? 1);
}
