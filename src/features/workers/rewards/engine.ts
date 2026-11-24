import type { EntryRuleKind, EntryStatus, RewardPlan } from "./types";

/**
 * How the entries of one source follow its events: the TypeScript side of
 * reward_reconcile() and reward_capped() in the migrations of 28.2 and 29.1.
 * Which rules pay an event and how much is evaluate.ts (reward_wishes_for()).
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

/** The status of something done under this plan. */
export function earnedStatus(plan: Pick<RewardPlan, "approval">): "pending" | "approved" {
  return plan.approval === "auto" ? "approved" : "pending";
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
