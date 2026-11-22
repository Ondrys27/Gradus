import type { Database } from "@/types/database";

type Tables = Database["public"]["Tables"];

export type MilestoneCategory = Database["public"]["Enums"]["milestone_category"];
export type MilestoneStatus = Database["public"]["Enums"]["milestone_status"];
export type TaskStatus = Database["public"]["Enums"]["task_status"];

export const MILESTONE_COLUMNS =
  "id, title, description, category, tag, target_date, status, position, completed_at, created_at, ai_feedback, reward, is_demo, reward_amount, reward_currency, reward_worker_id";
export const TASK_COLUMNS =
  "id, milestone_id, parent_task_id, title, description, status, position, due_date, completed_at, reward_amount, reward_currency";

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
> & {
  /** Sample data of the tutorial (labelled "sample"); absent in older reads. */
  is_demo?: boolean | null;
  /** The fixed reward of the project and whose it is (28.2); absent in older reads. */
  reward_amount?: number | null;
  reward_currency?: string | null;
  reward_worker_id?: string | null;
};

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
> & {
  /** The reward for completing it (28.2); absent in older reads. */
  reward_amount?: number | null;
  reward_currency?: string | null;
};
