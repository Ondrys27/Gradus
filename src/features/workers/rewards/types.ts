/**
 * Worker rewards (28.2): a plan of rules per person, rewards as entries the
 * database makes from events. Mirrors supabase/migrations/20261127090000_reward_plans.sql.
 */

export const RULE_KINDS = [
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
] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

/** What an entry was paid by: a rule kind, a price on a deal or milestone, or by hand. */
export type EntryRuleKind = RuleKind | "price" | "manual";

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
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** What can carry a price of its own. */
export type PricedSource = "crm_task" | "worker_task" | "task" | "deal" | "milestone";

export type Approval = "auto" | "manual";

export type RuleFilter = { onTimeOnly?: boolean; minDealValue?: number };

export type RewardRule = {
  id: string;
  plan_id: string;
  worker_id: string;
  kind: RuleKind;
  amount: number | null;
  percent: number | null;
  filter: RuleFilter;
  cap_per_period: number | null;
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
export const RULE_COLUMNS =
  "id, plan_id, worker_id, kind, amount, percent, filter, cap_per_period, active, position" as const;
export const PLAN_COLUMNS =
  "id, space_id, worker_id, name, approval, currency, active_from, active_to, notes" as const;
