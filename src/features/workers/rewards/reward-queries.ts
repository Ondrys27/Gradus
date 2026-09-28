"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { JarvisJobError, postJarvisJob } from "@/features/jarvis/queries";
import { createClient } from "@/lib/supabase/client";
import { workerKeys } from "../queries";
import {
  compiledRuleSchema,
  parseTree,
  storedRule,
  type CompiledRule,
  type RewardProposal,
  type RewardTree,
} from "./reward-tree";

/** Active rules are few; the cap only guards the page. */
const RULES_LIMIT = 200;

const rewardKeys = {
  draft: (userId: string) => ["workers", userId, "rewards", "draft"] as const,
  rules: (userId: string) => ["workers", userId, "rewards", "rules"] as const,
};

/** The tree the owner is editing; an empty one until the first save. */
export function useRewardDraft() {
  const { user } = useSession();
  return useQuery({
    queryKey: rewardKeys.draft(user.id),
    queryFn: async (): Promise<RewardTree> => {
      const { data, error } = await createClient()
        .from("reward_drafts")
        .select("tree")
        .eq("owner_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return parseTree(data?.tree ?? null);
    },
  });
}

/** Saves the whole tree after each edit; the editor shows it at once and rolls back on failure. */
export function useSaveRewardDraft() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const key = rewardKeys.draft(user.id);
  return useMutation({
    mutationFn: async (tree: RewardTree) => {
      const { error } = await createClient()
        .from("reward_drafts")
        .upsert({ owner_id: user.id, tree }, { onConflict: "owner_id" });
      if (error) throw error;
    },
    onMutate: async (tree) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<RewardTree>(key);
      queryClient.setQueryData(key, tree);
      return { previous };
    },
    onError: (_error, _tree, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
  });
}

/** The rules earnings are generated from right now. */
export function useActiveRewardRules() {
  const { user } = useSession();
  return useQuery({
    queryKey: rewardKeys.rules(user.id),
    queryFn: async (): Promise<CompiledRule[]> => {
      const { data, error } = await createClient()
        .from("reward_rules")
        .select("name, worker_id, rules")
        .eq("owner_id", user.id)
        .eq("is_active", true)
        .order("created_at")
        .limit(RULES_LIMIT);
      if (error) throw error;
      return data.flatMap((row) => {
        const rule = storedRule(row);
        return rule ? [rule] : [];
      });
    },
  });
}

/** Jarvis reads the tree and proposes rules with a summary. Nothing is saved yet. */
export function useRewardSetup() {
  return useMutation({
    mutationKey: ["jarvis", "reward-setup"],
    mutationFn: async (tree: RewardTree): Promise<RewardProposal> => {
      const result = await postJarvisJob<{ proposal: RewardProposal }>({
        kind: "rewardSetup",
        tree,
      });
      if (!result.ok) throw new JarvisJobError(result.code);
      return result.proposal;
    },
  });
}

/** The owner confirmed: the new rules replace the active ones, the old stay for history. */
export function useConfirmRewardRules() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rules: CompiledRule[]) => {
      const checked = rules.map((rule) => compiledRuleSchema.parse(rule));
      const { error } = await createClient().rpc("replace_reward_rules", { _rules: checked });
      if (error) throw error;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: workerKeys.all(user.id) }),
  });
}
