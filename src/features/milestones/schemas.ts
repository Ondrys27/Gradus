import { z } from "zod";

export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 2000;
export const TAG_MAX = 30;
/** Matches the milestones_reward_length check in the database. */
export const REWARD_MAX = 120;

/** Translation keys under `milestones.errors`. */
export type MilestoneErrorKey =
  "titleRequired" | "titleTooLong" | "descriptionTooLong" | "tagTooLong" | "rewardTooLong";

const title = z.string().trim().min(1, "titleRequired").max(TITLE_MAX, "titleTooLong");
const description = z.string().trim().max(DESCRIPTION_MAX, "descriptionTooLong");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const milestoneSchema = z.object({
  title,
  description,
  category: z.enum(["work", "personal"]),
  tag: z.string().trim().max(TAG_MAX, "tagTooLong"),
  target_date: isoDate.nullable(),
  reward: z.string().trim().max(REWARD_MAX, "rewardTooLong"),
});
export type MilestoneInput = z.infer<typeof milestoneSchema>;

export const taskSchema = z.object({
  title,
  description,
  status: z.enum(["todo", "in_progress", "done"]),
  due_date: isoDate.nullable(),
});
export type TaskInput = z.infer<typeof taskSchema>;

/** First error per field, as a translation key. */
export function fieldErrors(error: z.ZodError): Partial<Record<string, MilestoneErrorKey>> {
  const result: Partial<Record<string, MilestoneErrorKey>> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0]);
    result[field] ??= issue.message as MilestoneErrorKey;
  }
  return result;
}

/** How a move was made, for analytics. */
export const MOVE_VIAS = ["map", "list", "keyboard", "menu", "undo"] as const;
export type MoveVia = (typeof MOVE_VIAS)[number];

/** moveTaskAction: the task, its new parent (null = level 1) and its index among the new siblings. */
export const moveTaskSchema = z.object({
  taskId: z.uuid(),
  parentId: z.uuid().nullable(),
  position: z.number().int().min(0).max(10_000),
  via: z.enum(MOVE_VIAS),
  /** Where it lands (0 = level 1) and whether its level changed, for analytics only. */
  depth: z.number().int().min(0).max(100),
  levelChanged: z.boolean(),
});
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;

export type MoveTaskFailure =
  "invalid" | "cycle" | "tooDeep" | "notFound" | "forbidden" | "readOnly" | "unknown";
export type MoveTaskResult = { ok: true } | { ok: false; error: MoveTaskFailure };

/** The code of a move_task() failure, from the exception it raised. */
export function moveTaskFailure(error: { message?: string } | null | undefined): MoveTaskFailure {
  const message = error?.message ?? "";
  if (message.includes("task_move_cycle")) return "cycle";
  if (message.includes("task_too_deep")) return "tooDeep";
  if (message.includes("task_not_found") || message.includes("task_parent_invalid")) {
    return "notFound";
  }
  if (message.includes("read_only")) return "readOnly";
  if (message.includes("forbidden") || message.includes("not_authenticated")) return "forbidden";
  return "unknown";
}
