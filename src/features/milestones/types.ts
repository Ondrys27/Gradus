import type { Database } from "@/types/database";

type Tables = Database["public"]["Tables"];

export type MilestoneCategory = Database["public"]["Enums"]["milestone_category"];
export type MilestoneStatus = Database["public"]["Enums"]["milestone_status"];
export type TaskStatus = Database["public"]["Enums"]["task_status"];

export const MILESTONE_COLUMNS =
  "id, title, description, category, tag, target_date, status, position, completed_at, created_at, ai_feedback, reward";
export const TASK_COLUMNS =
  "id, milestone_id, parent_task_id, title, description, status, position, due_date, completed_at";

export type Milestone = Pick<
  Tables["milestones"]["Row"],
  | "id"
  | "title"
  | "description"
  | "category"
  | "tag"
  | "target_date"
  | "status"
  | "position"
  | "completed_at"
  | "created_at"
  | "ai_feedback"
  | "reward"
>;

/** A milestone with its task counts, which the database computes at read time. */
export type MilestoneWithCounts = Milestone & { total: number; done: number };

export type Task = Pick<
  Tables["tasks"]["Row"],
  | "id"
  | "milestone_id"
  | "parent_task_id"
  | "title"
  | "description"
  | "status"
  | "position"
  | "due_date"
  | "completed_at"
>;
