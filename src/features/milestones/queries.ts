"use client";

import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { useWorkspaceId } from "@/features/account/workspace-queries";
import { JarvisJobError, postJarvisJob } from "@/features/jarvis/queries";
import { createClient } from "@/lib/supabase/client";
import type { MilestoneInput, TaskInput } from "./schemas";
import {
  applyStatusChange,
  nextPosition,
  reopenAncestors,
  reopenedMilestone,
  reorderSiblings,
  subtreeIds,
  type PositionChange,
} from "./task-tree";
import {
  MILESTONE_COLUMNS,
  TASK_COLUMNS,
  type Milestone,
  type MilestoneStatus,
  type MilestoneWithCounts,
  type Task,
  type TaskStatus,
} from "./types";

/** A person has a handful of milestones; this only bounds the query. */
const MILESTONE_LIMIT = 200;
/** Tasks of one milestone, subtasks included; this only bounds the query. */
const TASK_LIMIT = 2000;

export const milestoneKeys = {
  all: (userId: string) => ["milestones", userId] as const,
  list: (userId: string) => ["milestones", userId, "list"] as const,
  detail: (userId: string, id: string) => ["milestones", userId, "detail", id] as const,
  tasks: (userId: string, id: string) => ["milestones", userId, "tasks", id] as const,
  taskMutation: (id: string) => ["milestones", "task-mutation", id] as const,
};

async function fetchMilestoneList(workspaceId: string): Promise<MilestoneWithCounts[]> {
  const supabase = createClient();
  const [milestones, counts] = await Promise.all([
    supabase
      .from("milestones")
      .select(MILESTONE_COLUMNS)
      .eq("user_id", workspaceId)
      .in("status", ["active", "completed"])
      .order("position")
      .limit(MILESTONE_LIMIT),
    supabase
      .from("milestone_task_counts")
      .select("milestone_id, total, done")
      .eq("user_id", workspaceId)
      .limit(1000),
  ]);
  if (milestones.error) throw milestones.error;
  if (counts.error) throw counts.error;
  const byMilestone = new Map(counts.data.map((row) => [row.milestone_id, row]));
  return milestones.data.map((milestone) => ({
    ...milestone,
    total: byMilestone.get(milestone.id)?.total ?? 0,
    done: byMilestone.get(milestone.id)?.done ?? 0,
  }));
}

export function useMilestones() {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: milestoneKeys.list(user.id),
    queryFn: () => fetchMilestoneList(workspaceId),
  });
}

/** `null` when the milestone does not exist or is not the user's. */
export function useMilestone(id: string) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: milestoneKeys.detail(user.id, id),
    queryFn: async (): Promise<Milestone | null> => {
      const { data, error } = await createClient()
        .from("milestones")
        .select(MILESTONE_COLUMNS)
        .eq("user_id", workspaceId)
        .eq("id", id)
        .maybeSingle();
      // A malformed id (22P02) is just a milestone that does not exist.
      if (error && error.code !== "22P02") throw error;
      return data;
    },
  });
}

export function useTasks(milestoneId: string) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: milestoneKeys.tasks(user.id, milestoneId),
    queryFn: async (): Promise<Task[]> => {
      const { data, error } = await createClient()
        .from("tasks")
        .select(TASK_COLUMNS)
        .eq("user_id", workspaceId)
        .eq("milestone_id", milestoneId)
        .order("position")
        .order("created_at")
        .limit(TASK_LIMIT);
      if (error) throw error;
      return data;
    },
  });
}

function toMilestoneRow(input: MilestoneInput) {
  return {
    title: input.title,
    description: input.description || null,
    category: input.category,
    tag: input.tag || null,
    target_date: input.target_date,
    reward: input.reward || null,
  };
}

function toTaskRow(input: TaskInput) {
  return {
    title: input.title,
    description: input.description || null,
    status: input.status,
    due_date: input.due_date,
  };
}

const REVIEW_MUTATION = ["milestones", "review"] as const;

/**
 * Jarvis reviews a new milestone (through /api/jarvis). The result lands in
 * the cache even when the dialog that created the milestone is gone.
 */
export function useReviewMilestone() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: REVIEW_MUTATION,
    mutationFn: async (id: string) => {
      const result = await postJarvisJob<{ feedback: string }>({
        kind: "milestoneReview",
        milestoneId: id,
      });
      if (!result.ok) throw new JarvisJobError(result.code);
      return { id, feedback: result.feedback };
    },
    onSuccess: ({ id, feedback }) => {
      queryClient.setQueryData<Milestone | null>(milestoneKeys.detail(user.id, id), (row) =>
        row ? { ...row, ai_feedback: feedback } : row,
      );
      queryClient.setQueryData<MilestoneWithCounts[]>(milestoneKeys.list(user.id), (list) =>
        list?.map((item) => (item.id === id ? { ...item, ai_feedback: feedback } : item)),
      );
    },
  });
}

/** Whether Jarvis is reviewing this milestone right now. */
export function useMilestoneReviewPending(id: string) {
  return useMutationState({
    filters: { mutationKey: REVIEW_MUTATION, status: "pending" },
    select: (mutation) => mutation.state.variables,
  }).includes(id);
}

export function useCreateMilestone() {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const review = useReviewMilestone();
  return useMutation({
    mutationFn: async (input: MilestoneInput) => {
      const list = queryClient.getQueryData<MilestoneWithCounts[]>(milestoneKeys.list(user.id));
      const position = list?.length ? Math.max(...list.map((m) => m.position)) + 1 : 0;
      const { data, error } = await createClient()
        .from("milestones")
        .insert({ ...toMilestoneRow(input), user_id: workspaceId, position })
        .select(MILESTONE_COLUMNS)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => {
      queryClient.setQueryData(milestoneKeys.detail(user.id, row.id), row);
      // Jarvis looks at every new milestone once; a failure only means no feedback.
      review.mutate(row.id);
      return queryClient.invalidateQueries({ queryKey: milestoneKeys.list(user.id) });
    },
  });
}

function syncMilestone(queryClient: QueryClient, userId: string, row: Milestone) {
  queryClient.setQueryData(milestoneKeys.detail(userId, row.id), row);
  queryClient.setQueryData<MilestoneWithCounts[]>(milestoneKeys.list(userId), (list) =>
    list?.map((item) => (item.id === row.id ? { ...item, ...row } : item)),
  );
}

export function useUpdateMilestone(id: string) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: MilestoneInput) => {
      const { data, error } = await createClient()
        .from("milestones")
        .update(toMilestoneRow(input))
        .eq("id", id)
        .select(MILESTONE_COLUMNS)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => syncMilestone(queryClient, user.id, row),
  });
}

/**
 * Finishing (and reopening) a milestone is always the user's own act. The database
 * refuses to finish one without tasks or with open ones (milestones_guard).
 */
export function useSetMilestoneStatus(id: string) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (status: MilestoneStatus) => {
      const { data, error } = await createClient()
        .from("milestones")
        .update({ status })
        .eq("id", id)
        .select(MILESTONE_COLUMNS)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => syncMilestone(queryClient, user.id, row),
  });
}

/** Tasks go with the milestone (cascade in the database). */
export function useDeleteMilestone(id: string) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await createClient().from("milestones").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: milestoneKeys.detail(user.id, id) });
      queryClient.removeQueries({ queryKey: milestoneKeys.tasks(user.id, id) });
      queryClient.setQueryData<MilestoneWithCounts[]>(milestoneKeys.list(user.id), (list) =>
        list?.filter((item) => item.id !== id),
      );
    },
  });
}

/**
 * Task mutations update the cache at once and save in the background. The database
 * has the last word: after the last pending change the list is read again, which also
 * picks up what it did on its own (completed_at, a reopened parent).
 */
function useTaskMutation<V, R = unknown>(
  milestoneId: string,
  options: {
    mutationFn: (variables: V) => Promise<R>;
    apply?: (tasks: Task[], variables: V) => Task[];
    onSuccess?: (result: R, variables: V, tasks: Task[]) => Task[];
  },
) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const key = milestoneKeys.tasks(user.id, milestoneId);
  const listKey = milestoneKeys.list(user.id);
  const detailKey = milestoneKeys.detail(user.id, milestoneId);

  return useMutation({
    mutationKey: milestoneKeys.taskMutation(milestoneId),
    mutationFn: options.mutationFn,
    onMutate: async (variables: V) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Task[]>(key);
      const previousMilestone = queryClient.getQueryData<Milestone | null>(detailKey);
      if (previous && options.apply) {
        const next = options.apply(previous, variables);
        queryClient.setQueryData<Task[]>(key, next);
        // An unticked task sends a completed milestone back to active, as the database does.
        if (previousMilestone) {
          const reopened = reopenedMilestone(previousMilestone, next);
          if (reopened !== previousMilestone) syncMilestone(queryClient, user.id, reopened);
        }
      }
      return { previous, previousMilestone };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      if (context?.previousMilestone) {
        syncMilestone(queryClient, user.id, context.previousMilestone);
      }
    },
    onSuccess: (result, variables) => {
      const { onSuccess } = options;
      if (onSuccess) {
        queryClient.setQueryData<Task[]>(key, (tasks) =>
          tasks ? onSuccess(result, variables, tasks) : tasks,
        );
      }
    },
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: milestoneKeys.taskMutation(milestoneId) }) > 1) {
        return;
      }
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: listKey });
      void queryClient.invalidateQueries({ queryKey: detailKey });
    },
  });
}

export function useCreateTask(milestoneId: string) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  return useTaskMutation<{ parentId: string | null; input: TaskInput }, Task>(milestoneId, {
    mutationFn: async ({ parentId, input }) => {
      const tasks =
        queryClient.getQueryData<Task[]>(milestoneKeys.tasks(user.id, milestoneId)) ?? [];
      const { data, error } = await createClient()
        .from("tasks")
        .insert({
          ...toTaskRow(input),
          user_id: workspaceId,
          milestone_id: milestoneId,
          parent_task_id: parentId,
          position: nextPosition(tasks, parentId),
        })
        .select(TASK_COLUMNS)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row, _variables, tasks) => reopenAncestors([...tasks, row], row.id),
  });
}

export function useUpdateTask(milestoneId: string) {
  return useTaskMutation<{ id: string; input: TaskInput }>(milestoneId, {
    mutationFn: async ({ id, input }) => {
      const { error } = await createClient().from("tasks").update(toTaskRow(input)).eq("id", id);
      if (error) throw error;
    },
    apply: (tasks, { id, input }) => {
      const { status, ...fields } = toTaskRow(input);
      const patched = tasks.map((task) => (task.id === id ? { ...task, ...fields } : task));
      // Status goes through the same rules as the checkbox.
      return applyStatusChange(patched, id, status).tasks;
    },
  });
}

export function useSetTaskStatus(milestoneId: string) {
  return useTaskMutation<{ id: string; status: TaskStatus }>(milestoneId, {
    mutationFn: async ({ id, status }) => {
      const { error } = await createClient().from("tasks").update({ status }).eq("id", id);
      if (error) throw error;
    },
    apply: (tasks, { id, status }) => applyStatusChange(tasks, id, status).tasks,
  });
}

/** Subtasks are deleted with their task (cascade in the database). */
export function useDeleteTask(milestoneId: string) {
  return useTaskMutation<string>(milestoneId, {
    mutationFn: async (id) => {
      const { error } = await createClient().from("tasks").delete().eq("id", id);
      if (error) throw error;
    },
    apply: (tasks, id) => {
      const removed = subtreeIds(tasks, id);
      return tasks.filter((task) => !removed.has(task.id));
    },
  });
}

/** Saves only the positions that changed; the caller computes them with `reorderSiblings`. */
export function useReorderTasks(milestoneId: string) {
  return useTaskMutation<{ activeId: string; overId: string; changes: PositionChange[] }>(
    milestoneId,
    {
      mutationFn: async ({ changes }) => {
        const results = await Promise.all(
          changes.map(({ id, position }) =>
            createClient().from("tasks").update({ position }).eq("id", id),
          ),
        );
        const failed = results.find((result) => result.error);
        if (failed?.error) throw failed.error;
      },
      apply: (tasks, { activeId, overId }) => reorderSiblings(tasks, activeId, overId).tasks,
    },
  );
}
