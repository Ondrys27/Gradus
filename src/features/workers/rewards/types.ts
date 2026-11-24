import type { RuleDefinition } from "./definition";

/**
 * Worker rewards (28.2, rules with any trigger since 29.1): a plan of rules
 * per person, rewards as entries the database makes from events. Mirrors
 * supabase/migrations/20261127090000_reward_plans.sql and
 * 20261205090000_reward_event_rules.sql.
 */

/**
 * What an entry was paid by: a rule (every rule is an event rule since 29.1;
 * entries of 28.2 whose rule is gone keep its old kind), a price on a task,
 * deal or milestone, or by hand.
 */
export const ENTRY_RULE_KINDS = [
  "event",
  "task_fixed",
  "task_default",
  "project_done",
  "per_meeting",
  "per_call",
  "per_contact",
  "deal_percent",
  "deal_fixed",
  "hourly",
  "monthly_fixed",
  "price",
  "manual",
] as const;
export type EntryRuleKind = (typeof ENTRY_RULE_KINDS)[number];

export const ENTRY_STATUSES = ["planned", "pending", "approved", "rejected", "paid"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const SOURCE_KINDS = [
  "crm_task",
  "worker_task",
  "task",
  "milestone",
  "deal",
  "meeting",
  "booking",
  "call",
  "contact",
  "work_session",
  "month",
  "manual",
  "contact_move",
  "deal_event",
  "calendar_event",
  "activity",
  "invoice",
  "bonus",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** What can carry a price of its own. */
export type PricedSource = "crm_task" | "worker_task" | "task" | "deal" | "milestone";

export type Approval = "auto" | "manual";

export type RewardRule = {
  id: string;
  plan_id: string;
  worker_id: string;
  definition: RuleDefinition;
  active: boolean;
  position: number;
};

export type RewardPlan = {
  id: string;
  space_id: string;
  worker_id: string;
  name: string;
  approval: Approval;
  currency: string;
  active_from: string | null;
  active_to: string | null;
  notes: string | null;
  rules: RewardRule[];
};

export type RewardEntry = {
  id: string;
  worker_id: string;
  source_kind: SourceKind;
  source_id: string | null;
  rule_id: string | null;
  rule_kind: EntryRuleKind;
  amount: number;
  currency: string;
  status: EntryStatus;
  occurred_at: string;
  approved_at: string | null;
  paid_at: string | null;
  payout_id: string | null;
  note: string | null;
  corrects_id: string | null;
};

export type RewardPayout = {
  id: string;
  worker_id: string;
  period_from: string | null;
  period_to: string | null;
  total: number;
  currency: string;
  paid_at: string;
  note: string | null;
  entries: number;
};

/** Sums of one person in one currency (reward_totals()). */
export type RewardTotals = {
  workerId: string;
  currency: string;
  /** Waiting, approved or paid, occurred in the period. */
  earned: number;
  pending: number;
  pendingCount: number;
  approved: number;
  approvedCount: number;
  planned: number;
  plannedCount: number;
  /** Paid out in the period. */
  paid: number;
};

export const ENTRY_COLUMNS =
  "id, worker_id, source_kind, source_id, rule_id, rule_kind, amount, currency, status, occurred_at, approved_at, paid_at, payout_id, note, corrects_id" as const;
export const PAYOUT_COLUMNS =
  "id, worker_id, period_from, period_to, total, currency, paid_at, note, entries" as const;
export const RULE_COLUMNS = "id, plan_id, worker_id, kind, definition, active, position" as const;
export const PLAN_COLUMNS =
  "id, space_id, worker_id, name, approval, currency, active_from, active_to, notes" as const;
