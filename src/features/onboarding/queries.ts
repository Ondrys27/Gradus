"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { accountKeys, useSession } from "@/features/account/queries";
import { PROFILE_COLUMNS } from "@/features/account/types";
import { useAwardXp } from "@/features/gamification/queries";
import { milestoneKeys } from "@/features/milestones/queries";
import { MILESTONE_COLUMNS, TASK_COLUMNS, type Milestone } from "@/features/milestones/types";
import { createClient } from "@/lib/supabase/client";
import { industryKeyOf, type IndustryKey } from "./industries";

/** The milestone plus its three suggested tasks, created together on step 4. */
export function useCreateFirstMilestone() {
  const { user } = useSession();
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
        .insert({ title, category: "work", user_id: user.id, position: 0 })
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
          user_id: user.id,
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

/**
 * Saves the chosen branch, marks the wizard done for good and awards its one
 * XP event. `award_xp` is idempotent, so a retried finish never double-pays.
 */
export function useFinishOnboarding() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const awardXp = useAwardXp();
  return useMutation({
    mutationFn: async (industry: IndustryKey) => {
      const { data, error } = await createClient()
        .from("profiles")
        .update({
          industry: industryKeyOf(industry),
          onboarding_completed_at: new Date().toISOString(),
        })
        .eq("id", user.id)
        .select(PROFILE_COLUMNS)
        .single();
      if (error) throw error;
      const { awarded, xp } = await awardXp.mutateAsync({
        kind: "onboarding_completed",
        idempotencyKey: "onboarding",
      });
      return { profile: data, awarded, xp };
    },
    onSuccess: ({ profile }) => queryClient.setQueryData(accountKeys.profile(user.id), profile),
  });
}
