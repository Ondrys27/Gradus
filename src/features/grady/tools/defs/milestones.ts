import { z } from "zod";
import {
  createMilestone,
  createTask,
  deleteTask,
  moveTask,
  nextMilestonePosition,
  setMilestoneStatus,
  setTaskStatus,
  updateMilestone,
  updateTask,
} from "@/features/milestones/ops";
import { DESCRIPTION_MAX, REWARD_MAX, TITLE_MAX } from "@/features/milestones/schemas";
import { nextPosition, openSubtasks, subtreeIds, taskDepth } from "@/features/milestones/task-tree";
import { MILESTONE_COLUMNS, type Task } from "@/features/milestones/types";
import type { Json } from "@/types/database";
import { readRow, type UndoRecord } from "../records";
import { defineTool, ToolError, type ToolContext } from "../types";
import { hrefs, inserted, isoDate, mustFind, ops, quoted, updated, uuid } from "./shared";

/** Tasks Grady adds with one call; a bigger plan is an import of a mind map. */
const TASKS_PER_CALL = 50;
const TREE_TASKS = 2000;

const title = z.string().trim().min(1).max(TITLE_MAX);
const leaf = z.object({ title, dueDate: isoDate.optional() });
const level2 = leaf.extend({ subtasks: z.array(leaf).max(TASKS_PER_CALL).optional() });
const level1 = leaf.extend({ subtasks: z.array(level2).max(TASKS_PER_CALL).optional() });
type TaskNode = { title: string; dueDate?: string; subtasks?: TaskNode[] };

function countNodes(nodes: TaskNode[] | undefined): number {
  return (nodes ?? []).reduce((sum, node) => sum + 1 + countNodes(node.subtasks), 0);
}

const tasksField = z
  .array(level1)
  .max(TASKS_PER_CALL)
  .refine((nodes) => countNodes(nodes) <= TASKS_PER_CALL, `at most ${TASKS_PER_CALL} tasks`);

type TreeRow = Pick<Task, "id" | "parent_task_id" | "position" | "status" | "title">;

async function milestoneTasks(ctx: ToolContext, milestoneId: string): Promise<TreeRow[]> {
  const { data, error } = await ctx.db
    .from("tasks")
    .select("id, parent_task_id, position, status, title")
    .eq("user_id", ctx.workspaceId)
    .eq("milestone_id", milestoneId)
    .limit(TREE_TASKS);
  if (error) throw error;
  return data;
}

/** Inserts a tree under `parentId`, parents before children, each through the shared write. */
async function insertTree(
  ctx: ToolContext,
  milestoneId: string,
  parentId: string | null,
  nodes: TaskNode[],
  existing: TreeRow[],
  records: UndoRecord[],
): Promise<string[]> {
  const ids: string[] = [];
  const rows = [...existing];
  for (const node of nodes) {
    const depth = parentId ? taskDepth(rows, parentId) + 1 : 0;
    const row = await createTask(ops(ctx), {
      workspaceId: ctx.workspaceId,
      milestoneId,
      parentId,
      input: { title: node.title, description: "", status: "todo", due_date: node.dueDate ?? null },
      position: nextPosition(rows as Task[], parentId),
      depth,
    });
    rows.push(row);
    records.push(inserted("tasks", row.id));
    ids.push(row.id);
    if (node.subtasks?.length) {
      ids.push(...(await insertTree(ctx, milestoneId, row.id, node.subtasks, rows, records)));
    }
  }
  return ids;
}

/**
 * What the database changed on its own next to the change (a done parent or
 * milestone reopened by a new or unticked task), so Undo puts it back too.
 */
async function statusSnapshot(ctx: ToolContext, milestoneId: string) {
  const [milestone, tasks] = await Promise.all([
    readRow(ctx.db, "milestones", { id: milestoneId }, ["id", "status"]),
    milestoneTasks(ctx, milestoneId),
  ]);
  return {
    milestone: (milestone?.status as string | undefined) ?? null,
    tasks: new Map(tasks.map((t) => [t.id, t.status])),
    rows: tasks,
  };
}

/**
 * The statuses the database changed next to the change, as records in the
 * order Undo needs them: Undo works from the last record to the first, so
 * the milestone comes first and the tasks from the top level down; a parent
 * is then done again only after everything below it is.
 */
async function sideEffects(
  ctx: ToolContext,
  milestoneId: string,
  before: Awaited<ReturnType<typeof statusSnapshot>>,
  skip: Set<string>,
): Promise<UndoRecord[]> {
  const after = await statusSnapshot(ctx, milestoneId);
  const changed: { id: string; status: string; depth: number }[] = [];
  for (const [id, status] of before.tasks) {
    if (skip.has(id)) continue;
    const now = after.tasks.get(id);
    if (now && now !== status) changed.push({ id, status, depth: taskDepth(after.rows, id) });
  }
  changed.sort((a, b) => a.depth - b.depth);
  const records: UndoRecord[] = [];
  if (before.milestone && after.milestone && before.milestone !== after.milestone) {
    records.push(updated("milestones", milestoneId, { status: before.milestone }));
  }
  for (const item of changed) {
    records.push(updated("tasks", item.id, { status: item.status } as Record<string, Json>));
  }
  return records;
}

export const milestoneTools = [
  defineTool({
    name: "create_milestone",
    section: "milestones",
    action: "update",
    kind: "write",
    risk: "instant",
    description:
      "Create a new milestone, optionally with its tasks and subtasks (up to three levels, 50 tasks) in one call. Use it when the user asks to plan a goal or put steps into milestones.",
    input: z.object({
      title,
      description: z.string().trim().max(DESCRIPTION_MAX).optional(),
      category: z.enum(["work", "personal"]).optional(),
      targetDate: isoDate.optional(),
      reward: z.string().trim().max(REWARD_MAX).optional(),
      tasks: tasksField.optional(),
    }),
    describe: (input, t) =>
      t("create_milestone", { title: quoted(input.title), count: countNodes(input.tasks) }),
    async execute(ctx, input) {
      const milestone = await createMilestone(ops(ctx), {
        workspaceId: ctx.workspaceId,
        input: {
          title: input.title,
          description: input.description ?? "",
          category: input.category ?? "work",
          tag: "",
          target_date: input.targetDate ?? null,
          reward: input.reward ?? "",
        },
        position: await nextMilestonePosition(ops(ctx), ctx.workspaceId),
        where: "grady",
      });
      const records: UndoRecord[] = [inserted("milestones", milestone.id)];
      const taskIds = await insertTree(ctx, milestone.id, null, input.tasks ?? [], [], records);
      return {
        output: { milestoneId: milestone.id, taskIds },
        records,
        href: hrefs.milestone(milestone.id),
      };
    },
    undoable: true,
    invalidates: ["milestones", "dashboard"],
  }),

  defineTool({
    name: "update_milestone",
    section: "milestones",
    action: "update",
    kind: "write",
    risk: "instant",
    description:
      "Change a milestone's title, description, category, target date or reward. Only the fields given change.",
    input: z.object({
      milestoneId: uuid,
      title: title.optional(),
      description: z.string().trim().max(DESCRIPTION_MAX).optional(),
      category: z.enum(["work", "personal"]).optional(),
      targetDate: isoDate.nullable().optional(),
      reward: z.string().trim().max(REWARD_MAX).optional(),
    }),
    describe: (input, t) => t("update_milestone", { title: quoted(input.title ?? "") }),
    async execute(ctx, input) {
      const row = await mustFind(
        ctx.db
          .from("milestones")
          .select(MILESTONE_COLUMNS)
          .eq("user_id", ctx.workspaceId)
          .eq("id", input.milestoneId)
          .maybeSingle(),
      );
      const next = {
        title: input.title ?? row.title,
        description: input.description ?? row.description ?? "",
        category: input.category ?? row.category,
        tag: row.tag ?? "",
        target_date: input.targetDate === undefined ? row.target_date : input.targetDate,
        reward: input.reward ?? row.reward ?? "",
      };
      await updateMilestone(ops(ctx), row.id, next);
      return {
        output: { milestoneId: row.id },
        records: [
          updated("milestones", row.id, {
            title: row.title,
            description: row.description,
            category: row.category,
            target_date: row.target_date,
            reward: row.reward,
          }),
        ],
        summary: ctx.t("update_milestone", { title: quoted(next.title) }),
        href: hrefs.milestone(row.id),
      };
    },
    undoable: true,
    invalidates: ["milestones"],
  }),

  defineTool({
    name: "add_tasks",
    section: "milestones",
    action: "update",
    kind: "write",
    risk: "instant",
    description:
      "Add tasks (with subtasks, up to 50 in one call) to an existing milestone, at the top level or under a task (parentTaskId). Find the milestone id with list_milestones or search_records first.",
    input: z.object({
      milestoneId: uuid,
      parentTaskId: uuid.optional(),
      tasks: tasksField.refine((nodes) => nodes.length > 0),
    }),
    describe: (input, t) =>
      t("add_tasks", {
        count: countNodes(input.tasks),
        title: quoted(input.tasks[0]?.title ?? ""),
      }),
    async execute(ctx, input) {
      const milestone = await mustFind(
        ctx.db
          .from("milestones")
          .select("id, title")
          .eq("user_id", ctx.workspaceId)
          .eq("id", input.milestoneId)
          .maybeSingle(),
      );
      const existing = await milestoneTasks(ctx, milestone.id);
      if (input.parentTaskId && !existing.some((task) => task.id === input.parentTaskId)) {
        throw new ToolError("notFound");
      }
      if (existing.length + countNodes(input.tasks) > TREE_TASKS)
        throw new ToolError("tooManyTasks");
      const before = await statusSnapshot(ctx, milestone.id);
      const records: UndoRecord[] = [];
      const ids = await insertTree(
        ctx,
        milestone.id,
        input.parentTaskId ?? null,
        input.tasks,
        existing,
        records,
      );
      // Undo deletes the new tasks first, then puts back what they reopened.
      const effects = await sideEffects(ctx, milestone.id, before, new Set(ids));
      return {
        output: { milestoneId: milestone.id, taskIds: ids },
        records: [...effects, ...records],
        summary: ctx.t("add_tasks_to", {
          count: ids.length,
          title: quoted(input.tasks[0]?.title ?? ""),
          milestone: quoted(milestone.title),
        }),
        href: hrefs.milestone(milestone.id),
      };
    },
    undoable: true,
    invalidates: ["milestones", "dashboard"],
  }),

  defineTool({
    name: "update_task",
    section: "milestones",
    action: "update",
    kind: "write",
    risk: "instant",
    description:
      "Rename a milestone task or change its description or due date. To tick or untick it use set_task_status.",
    input: z.object({
      taskId: uuid,
      title: title.optional(),
      description: z.string().trim().max(DESCRIPTION_MAX).optional(),
      dueDate: isoDate.nullable().optional(),
    }),
    describe: (input, t) => t("update_task", { title: quoted(input.title ?? "") }),
    async execute(ctx, input) {
      const task = await mustFind(
        ctx.db
          .from("tasks")
          .select("id, milestone_id, title, description, status, due_date")
          .eq("user_id", ctx.workspaceId)
          .eq("id", input.taskId)
          .maybeSingle(),
      );
      const next = {
        title: input.title ?? task.title,
        description: input.description ?? task.description ?? "",
        status: task.status,
        due_date: input.dueDate === undefined ? task.due_date : input.dueDate,
      };
      await updateTask(ops(ctx), task.id, next);
      return {
        output: { taskId: task.id },
        records: [
          updated("tasks", task.id, {
            title: task.title,
            description: task.description,
            due_date: task.due_date,
          }),
        ],
        summary: ctx.t("update_task", { title: quoted(next.title) }),
        href: hrefs.milestone(task.milestone_id),
      };
    },
    undoable: true,
    invalidates: ["milestones", "dashboard"],
  }),

  defineTool({
    name: "set_task_status",
    section: "milestones",
    action: "update",
    kind: "write",
    risk: "instant",
    description:
      "Tick a milestone task as done, or put it back to open. A task with open subtasks can not be ticked until they are all done. Never completes the milestone itself.",
    input: z.object({ taskId: uuid, done: z.boolean() }),
    describe: (input, t) => t(input.done ? "task_done" : "task_reopened", { title: "" }),
    async execute(ctx, input) {
      const task = await mustFind(
        ctx.db
          .from("tasks")
          .select("id, milestone_id, title, status")
          .eq("user_id", ctx.workspaceId)
          .eq("id", input.taskId)
          .maybeSingle(),
      );
      const tasks = await milestoneTasks(ctx, task.milestone_id);
      const status = input.done ? "done" : "todo";
      if (input.done && openSubtasks(tasks as Task[], task.id) > 0) {
        throw new ToolError("openSubtasks", "The task has open subtasks; they must be done first.");
      }
      const before = await statusSnapshot(ctx, task.milestone_id);
      await setTaskStatus(ops(ctx), {
        id: task.id,
        status,
        previous: task.status,
        depth: taskDepth(tasks, task.id),
        where: "milestone",
      });
      const effects = await sideEffects(ctx, task.milestone_id, before, new Set([task.id]));
      return {
        output: { taskId: task.id, status },
        // Undo puts the task back first, then what its change reopened above it.
        records: [...effects, updated("tasks", task.id, { status: task.status })],
        summary: ctx.t(input.done ? "task_done" : "task_reopened", { title: quoted(task.title) }),
        href: hrefs.milestone(task.milestone_id),
        awards:
          input.done && task.status !== "done"
            ? [{ reason: "task_completed", refId: task.id }]
            : [],
      };
    },
    undoable: true,
    invalidates: ["milestones", "dashboard", "game"],
  }),

  defineTool({
    name: "move_task",
    section: "milestones",
    action: "update",
    kind: "write",
    risk: "instant",
    description:
      "Move a milestone task (with its subtasks) under another task of the same milestone, or to the top level (parentTaskId null), at a place among its new siblings (0 = first; leave out for last).",
    input: z.object({
      taskId: uuid,
      parentTaskId: uuid.nullable(),
      position: z.number().int().min(0).max(10_000).optional(),
    }),
    describe: (_input, t) => t("move_task", { title: "" }),
    async execute(ctx, input) {
      const task = await mustFind(
        ctx.db
          .from("tasks")
          .select("id, milestone_id, title, parent_task_id, position")
          .eq("user_id", ctx.workspaceId)
          .eq("id", input.taskId)
          .maybeSingle(),
      );
      const tasks = await milestoneTasks(ctx, task.milestone_id);
      if (input.parentTaskId && !tasks.some((row) => row.id === input.parentTaskId))
        throw new ToolError("notFound");
      if (input.parentTaskId && subtreeIds(tasks as Task[], task.id).has(input.parentTaskId))
        throw new ToolError("cycle");
      const siblings = tasks.filter(
        (row) => row.parent_task_id === input.parentTaskId && row.id !== task.id,
      );
      const position = Math.min(input.position ?? siblings.length, siblings.length);
      const depthOf = (parentId: string | null) => (parentId ? taskDepth(tasks, parentId) + 1 : 0);
      const index = tasks
        .filter((row) => row.parent_task_id === task.parent_task_id)
        .sort((a, b) => a.position - b.position)
        .findIndex((row) => row.id === task.id);
      const result = await moveTask(ops(ctx), {
        taskId: task.id,
        parentId: input.parentTaskId,
        position,
        via: "menu",
        depth: depthOf(input.parentTaskId),
        levelChanged: depthOf(input.parentTaskId) !== depthOf(task.parent_task_id),
      });
      if (!result.ok) throw new ToolError(result.error);
      return {
        output: { taskId: task.id },
        records: [
          updated("tasks", task.id, {
            parent_task_id: task.parent_task_id,
            position: Math.max(0, index),
          }),
        ],
        summary: ctx.t("move_task", { title: quoted(task.title) }),
        href: hrefs.milestone(task.milestone_id),
      };
    },
    undoable: true,
    // Back through move_task(), so the siblings are numbered as the database numbers them.
    async undo(ctx, records) {
      const record = records[0];
      if (!record) return { ok: true };
      const row = await readRow(ctx.db, "tasks", record.match, [
        "id",
        "updated_at",
        "parent_task_id",
      ]);
      if (!row) return { ok: false, reason: "gone" };
      if (record.stamp && Date.parse(String(row.updated_at)) !== Date.parse(record.stamp)) {
        return { ok: false, reason: "changed" };
      }
      const result = await moveTask(ops(ctx), {
        taskId: String(record.match.id),
        parentId: (record.before?.parent_task_id as string | null) ?? null,
        position: Number(record.before?.position ?? 0),
        via: "undo",
        depth: 0,
        levelChanged: row.parent_task_id !== (record.before?.parent_task_id ?? null),
      });
      return result.ok ? { ok: true } : { ok: false, reason: "failed" };
    },
    invalidates: ["milestones"],
  }),

  defineTool({
    name: "delete_task",
    section: "milestones",
    action: "update",
    kind: "write",
    risk: "confirm",
    description:
      "Delete a milestone task together with all its subtasks. The user confirms it first.",
    input: z.object({ taskId: uuid }),
    describe: (_input, t) => t("delete_task", { title: "", count: 0 }),
    async prepare(ctx, input) {
      const task = await mustFind(
        ctx.db
          .from("tasks")
          .select("id, milestone_id, title")
          .eq("user_id", ctx.workspaceId)
          .eq("id", input.taskId)
          .maybeSingle(),
      );
      const below =
        subtreeIds((await milestoneTasks(ctx, task.milestone_id)) as Task[], task.id).size - 1;
      return {
        summary: ctx.t("delete_task", { title: quoted(task.title), count: Math.max(0, below) }),
        href: hrefs.milestone(task.milestone_id),
      };
    },
    async execute(ctx, input) {
      const task = await mustFind(
        ctx.db
          .from("tasks")
          .select("id, milestone_id, title")
          .eq("user_id", ctx.workspaceId)
          .eq("id", input.taskId)
          .maybeSingle(),
      );
      const removed = subtreeIds(
        (await milestoneTasks(ctx, task.milestone_id)) as Task[],
        task.id,
      ).size;
      await deleteTask(ops(ctx), task.id, removed);
      return {
        output: { deleted: removed },
        summary: ctx.t("deleted_task", { title: quoted(task.title) }),
      };
    },
    undoable: false,
    invalidates: ["milestones", "dashboard"],
  }),

  defineTool({
    name: "complete_milestone",
    section: "milestones",
    action: "update",
    kind: "write",
    risk: "confirm",
    description:
      "Complete a milestone, only when the user explicitly asks for it and all its tasks are done (and it has at least one). The user confirms it first. Never call it on your own initiative.",
    input: z.object({ milestoneId: uuid }),
    describe: (_input, t) => t("complete_milestone", { title: "" }),
    async prepare(ctx, input) {
      const milestone = await mustFind(
        ctx.db
          .from("milestones")
          .select("id, title, status")
          .eq("user_id", ctx.workspaceId)
          .eq("id", input.milestoneId)
          .maybeSingle(),
      );
      const tasks = await milestoneTasks(ctx, milestone.id);
      if (milestone.status === "completed") throw new ToolError("alreadyCompleted");
      if (tasks.length === 0) throw new ToolError("milestoneHasNoTasks");
      const open = tasks.filter((task) => task.status !== "done").length;
      if (open > 0) throw new ToolError("milestoneNotReady", `${open} tasks are still open.`);
      return {
        summary: ctx.t("complete_milestone", { title: quoted(milestone.title) }),
        href: hrefs.milestone(milestone.id),
      };
    },
    async execute(ctx, input) {
      const before = await mustFind(
        ctx.db
          .from("milestones")
          .select("id, status")
          .eq("user_id", ctx.workspaceId)
          .eq("id", input.milestoneId)
          .maybeSingle(),
      );
      const row = await setMilestoneStatus(ops(ctx), input.milestoneId, "completed");
      return {
        output: { milestoneId: row.id, status: row.status },
        records: [updated("milestones", row.id, { status: before.status })],
        summary: ctx.t("completed_milestone", { title: quoted(row.title) }),
        href: hrefs.milestone(row.id),
        awards: [
          {
            reason: "milestone_completed",
            refId: row.id,
            celebrate: { moment: "milestone", subtitle: row.title, reward: row.reward },
          },
        ],
      };
    },
    undoable: true,
    invalidates: ["milestones", "dashboard", "game"],
  }),
];
