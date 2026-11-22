import type { EntryRuleKind, EntryStatus, RewardPlan, RewardRule } from "./types";

/**
 * How an event turns into reward entries: the rules of the TypeScript side of
 * the engine the database runs (reward_task_wishes(), reward_sync_deal(),
 * reward_event(), reward_capped() and reward_reconcile() in
 * supabase/migrations/20261127090000_reward_plans.sql). The database is what
 * runs; these pure functions say the same thing in one readable place and
 * are tested with the same cases as src/lib/supabase/reward-plans-schema.test.ts.
 *
 * An event first becomes wishes (what the source should have: one per person
 * and rule), then reconcile() says what to do so the stored entries match:
 * nothing twice, an undone event taken back, a paid one corrected.
 */

export type Wish = {
  workerId: string;
  ruleKind: EntryRuleKind;
  ruleId: string | null;
  amount: number;
  currency: string;
  /** planned while the work is not done; pending or approved once it is. */
  status: "planned" | "pending" | "approved";
  occurredAt: string;
  cap: number | null;
};

/** An entry of one source as reconcile() reads it. */
export type EngineEntry = {
  id: string;
  workerId: string;
  ruleKind: EntryRuleKind;
  ruleId: string | null;
  amount: number;
  status: EntryStatus;
};

export type ReconcileAction =
  | { type: "insert"; wish: Wish }
  | { type: "delete"; entryId: string }
  /** A paid entry whose event was undone: a negative approved entry, the entry reversed. */
  | { type: "correct"; entryId: string; amount: number }
  /** A planned entry with a new amount or a planned one earned (done). */
  | { type: "update"; entryId: string; wish: Wish }
  /** An earned, not yet paid entry whose task was reopened: planned again. */
  | { type: "replan"; entryId: string; wish: Wish };

export type ReconcileMode = "sync" | "add";

type PlanWithRules = Pick<RewardPlan, "approval" | "currency"> & {
  rules: Array<Pick<RewardRule, "id" | "kind" | "amount" | "percent" | "filter" | "cap_per_period" | "active" | "position">>;
};

/** The status of something done under this plan. */
export function earnedStatus(plan: Pick<RewardPlan, "approval">): "pending" | "approved" {
  return plan.approval === "auto" ? "approved" : "pending";
}

function activeRules(plan: PlanWithRules, kind: RewardRule["kind"]) {
  return plan.rules
    .filter((rule) => rule.active && rule.kind === kind)
    .sort((a, b) => a.position - b.position);
}

/**
 * A task of any kind for one person: its own price (planned while open, the
 * task_fixed rule's on-time filter and cap apply), else every task_default
 * rule once it is done.
 */
export function taskWishes(input: {
  plan: PlanWithRules | null;
  workerId: string | null;
  done: boolean;
  at: string;
  onTime: boolean;
  price: number | null;
  priceCurrency: string | null;
}): Wish[] {
  const { plan, workerId } = input;
  if (!plan || !workerId) return [];
  const status = input.done ? earnedStatus(plan) : "planned";
  if (input.price !== null) {
    const rule = activeRules(plan, "task_fixed")[0];
    if (input.done && rule?.filter.onTimeOnly && !input.onTime) return [];
    return [
      {
        workerId,
        ruleKind: "task_fixed",
        ruleId: rule?.id ?? null,
        amount: input.price,
        currency: input.priceCurrency ?? plan.currency,
        status,
        occurredAt: input.at,
        cap: rule?.cap_per_period ?? null,
      },
    ];
  }
  if (!input.done) return [];
  return activeRules(plan, "task_default")
    .filter((rule) => !(rule.filter.onTimeOnly && !input.onTime))
    .map((rule) => ({
      workerId,
      ruleKind: "task_default" as const,
      ruleId: rule.id,
      amount: rule.amount ?? 0,
      currency: plan.currency,
      status,
      occurredAt: input.at,
      cap: rule.cap_per_period,
    }));
}

/** The share of a deal's value (without VAT), on haléře. */
export function dealShare(value: number, percent: number): number {
  return Math.round(value * percent) / 100;
}

/**
 * A deal for one person on it: its own price (planned while open), and once
 * won the deal_fixed and deal_percent rules. A minimum value is in the plan's
 * currency, so it only lets through a deal in that currency; a share is in
 * the deal's currency, its cap only counts in the plan's.
 */
export function dealWishes(input: {
  plan: PlanWithRules | null;
  workerId: string;
  state: "open" | "won" | "lost";
  at: string;
  value: number | null;
  currency: string;
  price: number | null;
  priceCurrency: string | null;
}): Wish[] {
  const { plan } = input;
  if (!plan || input.state === "lost") return [];
  const status = input.state === "won" ? earnedStatus(plan) : "planned";
  const wishes: Wish[] = [];
  if (input.price !== null) {
    wishes.push({
      workerId: input.workerId,
      ruleKind: "price",
      ruleId: null,
      amount: input.price,
      currency: input.priceCurrency ?? input.currency,
      status,
      occurredAt: input.at,
      cap: null,
    });
  }
  if (input.state !== "won") return wishes;
  const value = input.value ?? 0;
  for (const rule of plan.rules
    .filter((item) => item.active && (item.kind === "deal_fixed" || item.kind === "deal_percent"))
    .sort((a, b) => a.position - b.position)) {
    const min = rule.filter.minDealValue;
    if (min !== undefined && (input.currency !== plan.currency || value < min)) continue;
    if (rule.kind === "deal_fixed") {
      wishes.push({
        workerId: input.workerId,
        ruleKind: "deal_fixed",
        ruleId: rule.id,
        amount: rule.amount ?? 0,
        currency: plan.currency,
        status,
        occurredAt: input.at,
        cap: rule.cap_per_period,
      });
    } else if (value > 0 && rule.percent !== null) {
      wishes.push({
        workerId: input.workerId,
        ruleKind: "deal_percent",
        ruleId: rule.id,
        amount: dealShare(value, rule.percent),
        currency: input.currency,
        status,
        occurredAt: input.at,
        cap: input.currency === plan.currency ? rule.cap_per_period : null,
      });
    }
  }
  return wishes;
}

/** A call, a meeting, a contact or hours: every active rule of the kind, `units` times. */
export function eventWishes(input: {
  plan: PlanWithRules | null;
  workerId: string;
  kind: "per_call" | "per_meeting" | "per_contact" | "hourly";
  at: string;
  units?: number;
}): Wish[] {
  const { plan } = input;
  if (!plan) return [];
  const units = input.units ?? 1;
  return activeRules(plan, input.kind).map((rule) => ({
    workerId: input.workerId,
    ruleKind: input.kind,
    ruleId: rule.id,
    amount: Math.round((rule.amount ?? 0) * units * 100) / 100,
    currency: plan.currency,
    status: earnedStatus(plan),
    occurredAt: input.at,
    cap: rule.cap_per_period,
  }));
}

/** What is still under a monthly cap, given what the rule already paid this month. */
export function capped(amount: number, cap: number | null, usedThisMonth: number): number {
  if (cap === null || amount <= 0) return amount;
  return Math.max(Math.min(amount, cap - usedThisMonth), 0);
}

const sameKey = (entry: EngineEntry, wish: Wish) =>
  entry.workerId === wish.workerId && entry.ruleKind === wish.ruleKind && entry.ruleId === wish.ruleId;

/**
 * Makes the entries of one source match its wishes. `sync` takes back what
 * has no wish any more (unpaid goes, paid gets a correction); `add` only adds
 * what is missing (facts like a call). An entry already earned stays as it is,
 * so the same event never pays twice. Entries added by hand and corrections
 * are not passed in.
 */
export function reconcile(
  existing: readonly EngineEntry[],
  wishes: readonly Wish[],
  mode: ReconcileMode = "sync",
): ReconcileAction[] {
  const used = new Set<number>();
  const actions: ReconcileAction[] = [];
  for (const entry of existing) {
    const index = wishes.findIndex((wish, i) => !used.has(i) && sameKey(entry, wish));
    if (index < 0) {
      if (mode === "add") continue;
      actions.push(
        entry.status === "paid"
          ? { type: "correct", entryId: entry.id, amount: -entry.amount }
          : { type: "delete", entryId: entry.id },
      );
      continue;
    }
    used.add(index);
    const wish = wishes[index]!;
    if (wish.status === "planned") {
      if (entry.status === "planned") {
        if (entry.amount !== wish.amount) actions.push({ type: "update", entryId: entry.id, wish });
      } else if (entry.status === "paid") {
        actions.push({ type: "correct", entryId: entry.id, amount: -entry.amount });
        actions.push({ type: "insert", wish });
      } else {
        actions.push({ type: "replan", entryId: entry.id, wish });
      }
    } else if (entry.status === "planned") {
      actions.push({ type: "update", entryId: entry.id, wish });
    }
  }
  wishes.forEach((wish, index) => {
    if (!used.has(index) && wish.amount > 0) actions.push({ type: "insert", wish });
  });
  return actions;
}
