"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { accountKeys, useSession } from "@/features/account/queries";
import { useWorkspaceId } from "@/features/account/workspace-queries";
import { PROFILE_COLUMNS } from "@/features/account/types";
import { fetchPaths, gameKeys, pathForIndustry } from "@/features/game/queries";
import type { GameMode } from "@/features/game/types";
import { jarvisKeys } from "@/features/jarvis/queries";
import { milestoneKeys } from "@/features/milestones/queries";
import { MILESTONE_COLUMNS, TASK_COLUMNS, type Milestone } from "@/features/milestones/types";
import { createClient } from "@/lib/supabase/client";
import { industryKeyOf, type IndustryKey } from "./industries";

/** The milestone plus its three suggested tasks, created together on step 4. */
export function useCreateFirstMilestone() {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      title,
      tasks,
    }: {
      title: string;
      tasks: [string, string, string];
    }): Promise<Milestone> => {
      const supabase = createClient();
      const { data: milestone, error: milestoneError } = await supabase
        .from("milestones")
        .insert({ title, category: "work", user_id: workspaceId, position: 0 })
        .select(MILESTONE_COLUMNS)
        .single();
      if (milestoneError) throw milestoneError;

      const taskRows = tasks
        .map((taskTitle) => taskTitle.trim())
        .filter(Boolean)
        .map((taskTitle, index) => ({
          title: taskTitle,
          status: "todo" as const,
          milestone_id: milestone.id,
          user_id: workspaceId,
          position: index,
        }));
      if (taskRows.length > 0) {
        const { error: tasksError } = await supabase
          .from("tasks")
          .insert(taskRows)
          .select(TASK_COLUMNS);
        if (tasksError) throw tasksError;
      }

      return milestone;
    },
    onSuccess: (row) => {
      queryClient.setQueryData(milestoneKeys.detail(user.id, row.id), row);
      void queryClient.invalidateQueries({ queryKey: milestoneKeys.list(user.id) });
    },
  });
}

export type FinishOnboardingInput = {
  industry: IndustryKey;
  /** Game (a path, levels, unlocks) or tool (everything open). */
  mode: GameMode;
  /** The path picked in game mode; the one for the industry when none was picked. */
  pathKey: string | null;
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
    mutationFn: async ({ industry, mode, pathKey }: FinishOnboardingInput) => {
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
      if (mode === "game") {
        const path = pathKey ?? pathForIndustry(await fetchPaths(), industryKeyOf(industry));
        if (path) {
          const { error: pathError } = await createClient().rpc("choose_path", {
            _path_key: path,
          });
          if (pathError) throw pathError;
        }
      }
      return { profile: data };
    },
    onSuccess: ({ profile }) => {
      queryClient.setQueryData(accountKeys.profile(user.id), profile);
      void queryClient.invalidateQueries({ queryKey: milestoneKeys.all(user.id) });
      void queryClient.invalidateQueries({ queryKey: gameKeys.all(user.id) });
      // Asking for suggestions lets the server add Jarvis's note about the new path.
      void queryClient.invalidateQueries({ queryKey: jarvisKeys.suggestions(user.id) });
    },
  });
}
