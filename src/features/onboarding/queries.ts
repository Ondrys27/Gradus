"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountKeys, useSession } from "@/features/account/queries";
import { useWorkspaceId } from "@/features/account/workspace-queries";
import { PROFILE_COLUMNS } from "@/features/account/types";
import { fetchPaths, gameKeys, pathForIndustry } from "@/features/game/queries";
import type { GameMode } from "@/features/game/types";
import { jarvisKeys } from "@/features/jarvis/queries";
import { milestoneKeys } from "@/features/milestones/queries";
import { MILESTONE_COLUMNS } from "@/features/milestones/types";
import { contactKeys } from "@/features/contacts/queries";
import type { ContactInput } from "@/features/contacts/schemas";
import { CONTACT_COLUMNS, type Contact } from "@/features/contacts/types";
import type { TablesInsert } from "@/types/database";
import { track } from "@/lib/analytics/client";
import { createClient } from "@/lib/supabase/client";
import { industryKeyOf, type IndustryKey } from "./industries";
import type { OnboardingStep } from "./types";

export const onboardingKeys = {
  milestone: (userId: string) => ["onboarding", userId, "milestone"] as const,
  contact: (userId: string) => ["onboarding", userId, "contact"] as const,
};

/** The hand-made first milestone (tool mode) and its suggested tasks, by position. */
export type FirstMilestone = {
  id: string;
  title: string;
  tasks: { id: string; title: string; position: number }[];
};

/**
 * What the wizard already saved for the first milestone, if anything. Until
 * the wizard is finished it covers the whole app, so the only milestone
 * without a path template can be the one it made. Looking it up here (not in
 * the browser) means coming back to the step — after Back, a reload or in
 * another tab — edits that milestone instead of adding a second one.
 */
export function useWizardMilestone() {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: onboardingKeys.milestone(user.id),
    queryFn: async (): Promise<FirstMilestone | null> => {
      const supabase = createClient();
      const { data: milestone, error } = await supabase
        .from("milestones")
        .select("id, title")
        .eq("user_id", workspaceId)
        .is("template_id", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!milestone) return null;
      const { data: tasks, error: tasksError } = await supabase
        .from("tasks")
        .select("id, title, position")
        .eq("user_id", workspaceId)
        .eq("milestone_id", milestone.id)
        .is("parent_task_id", null)
        .order("position", { ascending: true })
        .limit(FIRST_TASKS);
      if (tasksError) throw tasksError;
      return { ...milestone, tasks: tasks ?? [] };
    },
    staleTime: Infinity,
  });
}

/** The wizard suggests three tasks for the first milestone. */
const FIRST_TASKS = 3;

/**
 * Creates the first milestone with its tasks, or — when the wizard already
 * made it — renames it and brings its tasks in line with the form: a task
 * keeps its row and only its title changes, an emptied one is removed and a
 * newly filled one is added. Never a second milestone.
 */
export function useSaveFirstMilestone() {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      existing,
      title,
      tasks,
    }: {
      existing: FirstMilestone | null;
      title: string;
      tasks: [string, string, string];
    }) => {
      const supabase = createClient();
      const titles = tasks.map((taskTitle) => taskTitle.trim());
      let milestoneId: string;
      if (existing) {
        milestoneId = existing.id;
        if (existing.title !== title) {
          const { error } = await supabase
            .from("milestones")
            .update({ title })
            .eq("user_id", workspaceId)
            .eq("id", existing.id);
          if (error) throw error;
          track("milestone_updated", { has_reward: false });
        }
      } else {
        const { data, error } = await supabase
          .from("milestones")
          .insert({ title, category: "work", user_id: workspaceId, position: 0 })
          .select(MILESTONE_COLUMNS)
          .single();
        if (error) throw error;
        milestoneId = data.id;
        queryClient.setQueryData(milestoneKeys.detail(user.id, data.id), data);
        track("milestone_created", {
          where: "onboarding",
          category: data.category,
          has_reward: false,
          has_target_date: false,
        });
      }

      const byPosition = new Map((existing?.tasks ?? []).map((task) => [task.position, task]));
      const kept: FirstMilestone["tasks"] = [];
      const inserts: TablesInsert<"tasks">[] = [];
      const removed: string[] = [];
      for (const [position, taskTitle] of titles.entries()) {
        const current = byPosition.get(position);
        if (current && !taskTitle) {
          removed.push(current.id);
        } else if (current) {
          if (current.title !== taskTitle) {
            const { error } = await supabase
              .from("tasks")
              .update({ title: taskTitle })
              .eq("user_id", workspaceId)
              .eq("id", current.id);
            if (error) throw error;
            track("task_updated", {});
          }
          kept.push({ ...current, title: taskTitle });
        } else if (taskTitle) {
          inserts.push({
            title: taskTitle,
            status: "todo",
            milestone_id: milestoneId,
            user_id: workspaceId,
            position,
          });
        }
      }
      if (removed.length > 0) {
        const { error } = await supabase
          .from("tasks")
          .delete()
          .eq("user_id", workspaceId)
          .in("id", removed);
        if (error) throw error;
        track("task_deleted", { removed: removed.length });
      }
      if (inserts.length > 0) {
        const { data, error } = await supabase
          .from("tasks")
          .insert(inserts)
          .select("id, title, position");
        if (error) throw error;
        kept.push(...data);
        for (let index = 0; index < inserts.length; index += 1) {
          track("task_created", { depth: 0, is_subtask: false });
        }
      }
      const saved: FirstMilestone = {
        id: milestoneId,
        title,
        tasks: kept.sort((a, b) => a.position - b.position),
      };
      return saved;
    },
    onSuccess: (saved) => {
      // Set right away: a step opened again must see this milestone, never an old "none yet".
      queryClient.setQueryData(onboardingKeys.milestone(user.id), saved);
    },
    // Half saved (the milestone, not all tasks): read it again so a retry edits it.
    onError: () => queryClient.invalidateQueries({ queryKey: onboardingKeys.milestone(user.id) }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: milestoneKeys.all(user.id) });
    },
  });
}

/**
 * The contact the wizard already added, if any — the same reasoning as the
 * first milestone: while the wizard covers the app, no other contact can exist.
 */
export function useWizardContact() {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: onboardingKeys.contact(user.id),
    queryFn: async (): Promise<Contact | null> => {
      const { data, error } = await createClient()
        .from("contacts")
        .select(CONTACT_COLUMNS)
        .eq("user_id", workspaceId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: Infinity,
  });
}

/** Adds the first contact, or edits the one the wizard added before. */
export function useSaveFirstContact() {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ existingId, input }: { existingId: string | null; input: ContactInput }) => {
      const supabase = createClient();
      const { data, error } = existingId
        ? await supabase
            .from("contacts")
            .update(input)
            .eq("user_id", workspaceId)
            .eq("id", existingId)
            .select(CONTACT_COLUMNS)
            .single()
        : await supabase
            .from("contacts")
            .insert({ ...input, user_id: workspaceId })
            .select(CONTACT_COLUMNS)
            .single();
      if (error) throw error;
      const filled = {
        has_email: Boolean(data.email),
        has_phone: Boolean(data.phone),
        has_website: Boolean(data.website),
      };
      if (existingId) track("contact_updated", filled);
      else track("contact_created", { source: "manual", where: "onboarding", ...filled });
      return data;
    },
    onSuccess: (row) => {
      queryClient.setQueryData(onboardingKeys.contact(user.id), row);
      queryClient.setQueryData(contactKeys.detail(user.id, row.id), row);
      void queryClient.invalidateQueries({ queryKey: contactKeys.all(user.id) });
    },
  });
}

export type FinishOnboardingInput = {
  industry: IndustryKey;
  /** Game (a path, levels, unlocks) or tool (everything open). */
  mode: GameMode;
  /** The path picked in game mode; the one for the industry when none was picked. */
  pathKey: string | null;
  /** The step where Skip ended the wizard, if it did. */
  skippedAt?: OnboardingStep;
};

/**
 * Saves the branch and the mode and marks the wizard done for good. In game
 * mode the account gets the chosen path, so its milestones lead to the locked
 * sections, and Jarvis points to them. A retried finish adds nothing twice
 * (choose_path skips steps the account already has).
 */
export function useFinishOnboarding() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ industry, mode, pathKey, skippedAt }: FinishOnboardingInput) => {
      if (mode === "game") {
        // Tool mode was picked first, its milestone saved, then Back to the
        // mode and game chosen: the path's milestones replace that one, as
        // they do when game is picked straight away. Until the wizard is
        // finished, a milestone without a template can only be the wizard's.
        const { data: removed, error: removeError } = await createClient()
          .from("milestones")
          .delete()
          .eq("user_id", user.id)
          .is("template_id", null)
          .select("id");
        if (removeError) throw removeError;
        removed?.forEach(() => track("milestone_deleted", {}));
      }
      const { data, error } = await createClient()
        .from("profiles")
        .update({
          industry: industryKeyOf(industry),
          mode,
          onboarding_completed_at: new Date().toISOString(),
        })
        .eq("id", user.id)
        .select(PROFILE_COLUMNS)
        .single();
      if (error) throw error;
      let chosen: string | null = null;
      if (mode === "game") {
        chosen = pathKey ?? pathForIndustry(await fetchPaths(), industryKeyOf(industry));
        if (chosen) {
          const { error: pathError } = await createClient().rpc("choose_path", {
            _path_key: chosen,
          });
          if (pathError) throw pathError;
          track("path_chosen", { path: chosen, where: "onboarding" });
        }
      }
      track("game_mode_changed", { to: mode, where: "onboarding" });
      track("onboarding_completed", {
        mode,
        industry: industryKeyOf(industry),
        ...(chosen ? { path: chosen } : {}),
        ...(skippedAt ? { skipped_at: skippedAt } : {}),
      });
      return { profile: data };
    },
    onSuccess: ({ profile }) => {
      queryClient.setQueryData(accountKeys.profile(user.id), profile);
      queryClient.removeQueries({ queryKey: ["onboarding", user.id] });
      void queryClient.invalidateQueries({ queryKey: milestoneKeys.all(user.id) });
      void queryClient.invalidateQueries({ queryKey: gameKeys.all(user.id) });
      // Asking for suggestions lets the server add Jarvis's note about the new path.
      void queryClient.invalidateQueries({ queryKey: jarvisKeys.suggestions(user.id) });
    },
  });
}
