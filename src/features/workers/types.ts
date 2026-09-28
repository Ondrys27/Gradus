import type { Database } from "@/types/database";

type Tables = Database["public"]["Tables"];
type Enums = Database["public"]["Enums"];

export type WorkerStatus = Enums["worker_status"];
export type EarningStatus = Enums["earning_status"];
export type RewardTrigger = Enums["reward_trigger"];
export type AppSection = Enums["app_section"];
export type TaskStatus = Enums["task_status"];

export const WORKER_COLUMNS = "id, name, email, job_title, status, user_id, created_at" as const;
export type Worker = Pick<
  Tables["workers"]["Row"],
  "id" | "name" | "email" | "job_title" | "status" | "user_id" | "created_at"
>;

export const INVITE_COLUMNS = "id, worker_id, code, expires_at, accepted_at" as const;
export type WorkerInvite = Pick<
  Tables["worker_invites"]["Row"],
  "id" | "worker_id" | "code" | "expires_at" | "accepted_at"
>;

export const PERMISSION_COLUMNS = "section, can_view, can_edit" as const;
export type WorkerPermission = Pick<
  Tables["worker_permissions"]["Row"],
  "section" | "can_view" | "can_edit"
>;

export const WORKER_TASK_COLUMNS =
  "id, worker_id, title, description, due_date, status, completed_at, created_at" as const;
export type WorkerTask = Pick<
  Tables["worker_tasks"]["Row"],
  "id" | "worker_id" | "title" | "description" | "due_date" | "status" | "completed_at" | "created_at"
>;

export const EARNING_COLUMNS =
  "id, worker_id, amount, currency, description, status, source, basis, approved_at, paid_at, created_at" as const;
export type Earning = Pick<
  Tables["worker_earnings"]["Row"],
  | "id"
  | "worker_id"
  | "amount"
  | "currency"
  | "description"
  | "status"
  | "source"
  | "basis"
  | "approved_at"
  | "paid_at"
  | "created_at"
>;

export const PAYMENT_COLUMNS = "id, worker_id, amount, currency, paid_at, note" as const;
export type Payment = Pick<
  Tables["worker_payments"]["Row"],
  "id" | "worker_id" | "amount" | "currency" | "paid_at" | "note"
>;

export type WorkSession = {
  id: string;
  started_at: string;
  effective_end: string;
  end_reason: Enums["session_end_reason"] | null;
  running: boolean;
};

/** One card of the list: a month of work, what is waiting for approval, the month's tasks. */
export type WorkerMonthStats = {
  workSeconds: number;
  earned: number;
  pendingAmount: number;
  pendingCount: number;
  tasksTotal: number;
  tasksDone: number;
};

export type WorkerBalance = { earned: number; pending: number; paidOut: number; owed: number };

/** The worker's own account: its display name and avatar, once the invite is accepted. */
export type WorkerProfile = { avatarUrl: string | null; displayName: string | null };

export const EARNING_STATUSES: EarningStatus[] = ["pending", "approved", "paid"];
