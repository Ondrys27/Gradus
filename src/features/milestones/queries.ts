"use client";

import { useRef } from "react";
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
import { track } from "@/lib/analytics/client";
import type { MindMapFormat, MindMapParseResult, MindMapTree } from "@/lib/mindmap/formats";
import { createClient } from "@/lib/supabase/client";
import { moveTaskAction } from "./actions";
import { MILESTONE_TASK_LIMIT, planImport, type ImportRow } from "./map-io";
import type { MilestoneInput, MoveTaskFailure, MoveVia, TaskInput } from "./schemas";
import {
  applyStatusChange,
  nextPosition,
  planMove,
  reopenAncestors,
  reopenedMilestone,
  subtreeIds,
  taskDepth,
  type MoveTarget,
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
const TASK_LIMIT = MILESTONE_TASK_LIMIT;

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
      track("milestone_review_requested", { auto: true });
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
      track("milestone_created", {
        where: "form",
        category: row.category,
        has_reward: Boolean(row.reward),
        has_target_date: Boolean(row.target_date),
      });
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
    onSuccess: (row) => {
      track("milestone_updated", { has_reward: Boolean(row.reward) });
      syncMilestone(queryClient, user.id, row);
    },
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
        .select(`${MILESTONE_COLUMNS}, template_id`)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => {
      if (row.status === "completed") {
        const counts = queryClient
          .getQueryData<MilestoneWithCounts[]>(milestoneKeys.list(user.id))
          ?.find((item) => item.id === row.id);
        const tasks = queryClient.getQueryData<Task[]>(milestoneKeys.tasks(user.id, row.id));
        const finished = row.completed_at ? new Date(row.completed_at) : new Date();
        track("milestone_completed", {
          milestone_id: row.id,
          from_template: row.template_id !== null,
          task_count: tasks?.length ?? counts?.total ?? 0,
          days_open: Math.max(
            0,
            Math.floor((finished.getTime() - new Date(row.created_at).getTime()) / 86_400_000),
          ),
          has_reward: Boolean(row.reward),
        });
      } else if (row.status === "active") {
        track("milestone_reopened", {});
      }
      syncMilestone(queryClient, user.id, row);
    },
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
      track("milestone_deleted", {});
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
    /** Mutations of one scope reach the server one after another, in order. */
    scope?: string;
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
    scope: options.scope ? { id: `${options.scope}:${milestoneId}` } : undefined,
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
      const depth = parentId ? taskDepth(tasks, parentId) + 1 : 0;
      track("task_created", { depth, is_subtask: depth > 0 });
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
      track("task_updated", {});
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
  // What the task was before the change, noted when the cache is updated, for the event.
  const before = useRef(new Map<string, { status: TaskStatus; depth: number }>());
  return useTaskMutation<{ id: string; status: TaskStatus }>(milestoneId, {
    mutationFn: async ({ id, status }) => {
      const { error } = await createClient().from("tasks").update({ status }).eq("id", id);
      if (error) throw error;
      const previous = before.current.get(id);
      before.current.delete(id);
      const depth = previous?.depth ?? 0;
      if (status === "done" && previous?.status !== "done") {
        track("task_completed", { depth, is_subtask: depth > 0, where: "milestone" });
      } else if (status !== "done" && previous?.status === "done") {
        track("task_reopened", { where: "milestone" });
      }
    },
    apply: (tasks, { id, status }) => {
      const task = tasks.find((item) => item.id === id);
      if (task) before.current.set(id, { status: task.status, depth: taskDepth(tasks, id) });
      return applyStatusChange(tasks, id, status).tasks;
    },
  });
}

/** Subtasks are deleted with their task (cascade in the database). */
export function useDeleteTask(milestoneId: string) {
  const removedCount = useRef(new Map<string, number>());
  return useTaskMutation<string>(milestoneId, {
    mutationFn: async (id) => {
      const { error } = await createClient().from("tasks").delete().eq("id", id);
      if (error) throw error;
      track("task_deleted", { removed: removedCount.current.get(id) ?? 1 });
      removedCount.current.delete(id);
    },
    apply: (tasks, id) => {
      const removed = subtreeIds(tasks, id);
      removedCount.current.set(id, removed.size);
      return tasks.filter((task) => !removed.has(task.id));
    },
  });
}

export class MoveTaskError extends Error {
  constructor(readonly code: MoveTaskFailure) {
    super(`move_task: ${code}`);
    this.name = "MoveTaskError";
  }
}

export type MoveRequest = { taskId: string; target: MoveTarget; via: MoveVia };

/**
 * Moves a task (with its subtree) through moveTaskAction, the same for the map,
 * the list and the keyboard. The cache moves at once by the same rules
 * (planMove) and goes back on a failure; the caller checks the plan first.
 */
export function useMoveTask(milestoneId: string) {
  // Where the task lands and whether its level changes, noted when the cache moves.
  const levels = useRef(new Map<string, { depth: number; changed: boolean }>());
  return useTaskMutation<MoveRequest>(milestoneId, {
    mutationFn: async ({ taskId, target, via }) => {
      const level = levels.current.get(taskId);
      levels.current.delete(taskId);
      const result = await moveTaskAction({
        taskId,
        parentId: target.parentId,
        position: target.index,
        via,
        depth: Math.min(level?.depth ?? 0, 100),
        levelChanged: level?.changed ?? false,
      });
      if (!result.ok) throw new MoveTaskError(result.error);
    },
    // Quick moves in a row (⌘↓ ⌘↓) reach the database in the order they were made.
    scope: "move-task",
    apply: (tasks, { taskId, target }) => {
      const plan = planMove(tasks, taskId, target);
      if (!plan.ok) return tasks;
      const depthOf = (parentId: string | null) => (parentId ? taskDepth(tasks, parentId) + 1 : 0);
      const depth = depthOf(target.parentId);
      levels.current.set(taskId, { depth, changed: depth !== depthOf(plan.from.parentId) });
      return plan.tasks;
    },
  });
}

// -----------------------------------------------------------------------------
// Mind map import

/** Rows per insert of an import, and ids per delete (they travel in the address). */
const IMPORT_CHUNK = 500;
const DELETE_CHUNK = 100;

type Supabase = ReturnType<typeof createClient>;

/** Reads a mind map file on the server (/api/mindmap/parse): the tree, or why not. */
export async function parseMindMapUpload(file: File): Promise<MindMapParseResult> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch("/api/mindmap/parse", { method: "POST", body });
  if (response.status === 413) return { ok: false, error: "tooLarge" };
  if (!response.ok) throw new Error(`mindmap parse: ${response.status}`);
  return (await response.json()) as MindMapParseResult;
}

async function deleteTasks(supabase: Supabase, ids: string[]) {
  for (let index = 0; index < ids.length; index += DELETE_CHUNK) {
    const { error } = await supabase
      .from("tasks")
      .delete()
      .in("id", ids.slice(index, index + DELETE_CHUNK));
    if (error) throw error;
  }
}

/**
 * Inserts an import level by level (parents exist before their children; a
 * done parent only ever gets done children, so the database's rules hold at
 * every step), through RLS like any task the user adds. If a step fails, the
 * tasks already added go again: deleting the first level takes everything
 * below it along.
 */
async function insertImport(
  supabase: Supabase,
  workspaceId: string,
  milestoneId: string,
  rows: ImportRow[],
) {
  const levels = new Map<number, ImportRow[]>();
  for (const row of rows) levels.set(row.level, [...(levels.get(row.level) ?? []), row]);
  const top = rows.filter((row) => row.level === 1).map((row) => row.id);
  try {
    for (const level of [...levels.keys()].sort((a, b) => a - b)) {
      const list = levels.get(level)!;
      for (let index = 0; index < list.length; index += IMPORT_CHUNK) {
        const { error } = await supabase.from("tasks").insert(
          list.slice(index, index + IMPORT_CHUNK).map((row) => ({
            id: row.id,
            user_id: workspaceId,
            milestone_id: milestoneId,
            parent_task_id: row.parent_task_id,
            title: row.title,
            status: row.status,
            position: row.position,
          })),
        );
        if (error) throw error;
      }
    }
  } catch (error) {
    await deleteTasks(supabase, top).catch(() => undefined);
    throw error;
  }
}

export type ImportTasksInput = {
  items: MindMapTree;
  format: MindMapFormat;
  /** Replaces the milestone's tasks: the new ones go in first, then the old ones are deleted. */
  replace: boolean;
  flattened: boolean;
};

/** Imports a mind map into a milestone; resolves once the new tasks are in the cache. */
export function useImportTasks(milestoneId: string) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  return useTaskMutation<ImportTasksInput, number>(milestoneId, {
    mutationFn: async ({ items, format, replace, flattened }) => {
      const key = milestoneKeys.tasks(user.id, milestoneId);
      const tasks = queryClient.getQueryData<Task[]>(key) ?? [];
      const old = replace ? siblingsOfRoot(tasks) : [];
      const rows = planImport(items, {
        startPosition: replace ? 0 : nextPosition(tasks, null),
        newId: () => crypto.randomUUID(),
      });
      const supabase = createClient();
      await insertImport(supabase, workspaceId, milestoneId, rows);
      if (old.length) await deleteTasks(supabase, old);
      track("mindmap_imported", {
        format,
        nodes: Math.min(rows.length, 5000),
        mode: replace ? "replace" : "append",
        flattened,
      });
      // The map aligns on the new tree, so it is read before this resolves.
      await queryClient.invalidateQueries({ queryKey: key });
      return rows.length;
    },
  });
}

function siblingsOfRoot(tasks: Task[]): string[] {
  return tasks.filter((task) => task.parent_task_id === null).map((task) => task.id);
}

/**
 * A new milestone straight from a mind map: the milestone, then its tasks.
 * If the tasks can not be added the milestone goes again. Jarvis reviews it
 * once the tasks are in, like every new milestone.
 */
export function useCreateMilestoneFromImport() {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const review = useReviewMilestone();
  return useMutation({
    mutationFn: async ({
      title,
      items,
      format,
      flattened,
    }: Omit<ImportTasksInput, "replace"> & { title: string }) => {
      const supabase = createClient();
      const list = queryClient.getQueryData<MilestoneWithCounts[]>(milestoneKeys.list(user.id));
      const position = list?.length ? Math.max(...list.map((m) => m.position)) + 1 : 0;
      const { data: milestone, error } = await supabase
        .from("milestones")
        .insert({ title, category: "work", user_id: workspaceId, position })
        .select(MILESTONE_COLUMNS)
        .single();
      if (error) throw error;
      const rows = planImport(items, { startPosition: 0, newId: () => crypto.randomUUID() });
      try {
        await insertImport(supabase, workspaceId, milestone.id, rows);
      } catch (cause) {
        await supabase.from("milestones").delete().eq("id", milestone.id);
        throw cause;
      }
      track("milestone_created", {
        where: "import",
        category: milestone.category,
        has_reward: false,
        has_target_date: false,
      });
      track("mindmap_imported", {
        format,
        nodes: Math.min(rows.length, 5000),
        mode: "new",
        flattened,
      });
      return milestone;
    },
    onSuccess: (row) => {
      queryClient.setQueryData(milestoneKeys.detail(user.id, row.id), row);
      review.mutate(row.id);
      return queryClient.invalidateQueries({ queryKey: milestoneKeys.list(user.id) });
    },
  });
}
