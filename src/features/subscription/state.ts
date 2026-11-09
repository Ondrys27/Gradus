import {
  isPaidPlanKey,
  PAID_PLAN_KEYS,
  type Billing,
  type PaidPlanKey,
  type PlanLimitKey,
  type PlanLimits,
} from "@/config/pricing";

/**
 * The subscription of a workspace and what may happen to it. The database decides the same in subscription_expired(),
 * subscription_request_change(), _cancel() and _resume()
 * (supabase/migrations/…_subscription_management.sql); this mirrors it for
 * the screen, so the page offers only what the database will accept.
 */

export const BILLINGS = ["monthly", "yearly"] as const satisfies readonly Billing[];
/** What the database stores; "expired" is computed, never stored. */
export const STORED_STATUSES = ["trialing", "active", "past_due", "cancelled"] as const;
export type StoredStatus = (typeof STORED_STATUSES)[number];

export const CANCEL_REASONS = [
  "too_expensive",
  "missing_features",
  "not_using",
  "switching",
  "temporary",
  "other",
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];
export const CANCEL_NOTE_MAX = 1000;

export type Subscription = {
  planKey: string;
  billing: Billing;
  status: StoredStatus;
  trialEndsAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelReason: CancelReason | null;
  /** A downgrade waiting for the end of the period. */
  scheduled: { planKey: string; billing: Billing; at: string } | null;
  /** The payment gateway the subscription runs through (Stripe), or none yet. */
  gateway: "stripe" | null;
  /**
   * The plan picked on the website before registering (step 23.3): only a
   * hint until the account pays; the database drops it with any change.
   */
  chosen: { planKey: PaidPlanKey; billing: Billing } | null;
};

export const SUBSCRIPTION_COLUMNS =
  "plan_key, billing, status, trial_ends_at, current_period_start, current_period_end, cancel_at_period_end, cancel_reason, scheduled_plan_key, scheduled_billing, scheduled_at, provider, chosen_plan_key, chosen_billing";

export type SubscriptionRow = {
  plan_key: string;
  billing: string;
  status: string;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancel_reason: string | null;
  scheduled_plan_key: string | null;
  scheduled_billing: string | null;
  scheduled_at: string | null;
  provider?: string | null;
  chosen_plan_key?: string | null;
  chosen_billing?: string | null;
};

const toBilling = (value: string | null): Billing => (value === "yearly" ? "yearly" : "monthly");

export function toSubscription(row: SubscriptionRow): Subscription {
  return {
    planKey: row.plan_key,
    billing: toBilling(row.billing),
    status: (STORED_STATUSES as readonly string[]).includes(row.status)
      ? (row.status as StoredStatus)
      : "active",
    trialEndsAt: row.trial_ends_at,
    periodStart: row.current_period_start,
    periodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    cancelReason: (CANCEL_REASONS as readonly string[]).includes(row.cancel_reason ?? "")
      ? (row.cancel_reason as CancelReason)
      : null,
    scheduled:
      row.scheduled_plan_key && row.scheduled_at
        ? {
            planKey: row.scheduled_plan_key,
            billing: toBilling(row.scheduled_billing),
            at: row.scheduled_at,
          }
        : null,
    gateway: row.provider === "stripe" ? "stripe" : null,
    chosen:
      isPaidPlanKey(row.chosen_plan_key) && row.chosen_billing
        ? { planKey: row.chosen_plan_key, billing: toBilling(row.chosen_billing) }
        : null,
  };
}

const passed = (at: string | null, now: Date) => at !== null && Date.parse(at) <= now.getTime();

/** The end of the period that is running: the trial's end while trialing. */
export function periodEndOf(sub: Subscription): string | null {
  return sub.status === "trialing" ? sub.trialEndsAt : sub.periodEnd;
}

/** As subscription_expired(): the trial ended, a cancellation reached its end, or the gateway cancelled. */
export function isExpired(sub: Subscription, now: Date = new Date()): boolean {
  if (sub.status === "trialing" && passed(sub.trialEndsAt, now)) return true;
  if (sub.cancelAtPeriodEnd && passed(periodEndOf(sub), now)) return true;
  return sub.status === "cancelled" && (sub.periodEnd === null || passed(sub.periodEnd, now));
}

/** Whether the plan is one of the catalog's; beta and others are the administration's. */
export function isManagedPlan(sub: Subscription): sub is Subscription & { planKey: PaidPlanKey } {
  return isPaidPlanKey(sub.planKey);
}

export type DisplayStatus = "beta" | "trialing" | "active" | "pastDue" | "ending" | "expired";

/** The one state the card shows. */
export function displayStatus(sub: Subscription, now: Date = new Date()): DisplayStatus {
  if (isExpired(sub, now)) return "expired";
  if (!isManagedPlan(sub)) return "beta";
  if (sub.cancelAtPeriodEnd) return "ending";
  if (sub.status === "trialing") return "trialing";
  if (sub.status === "past_due") return "pastDue";
  return "active";
}

// ---------------------------------------------------------------------------
// Paying (step 23.1)
// ---------------------------------------------------------------------------

/** A subscription that runs in Stripe: changes go through Stripe's API. */
export function hasLiveGateway(sub: Subscription, now: Date = new Date()): boolean {
  return sub.gateway === "stripe" && sub.status !== "cancelled" && !isExpired(sub, now);
}

/**
 * How a catalog plan is paid for and changed:
 * - `gateway`: it runs in Stripe; a change, cancelling and resuming go
 *   through Stripe's API, the webhook writes the outcome;
 * - `checkout`: nothing runs in Stripe (the free trial without a card, or it
 *   has ended), paying starts a Stripe Checkout;
 * - `manual`: the administration set it by hand, it is changed as before;
 * - `none`: beta and plans outside the catalog, which Checkout never offers.
 */
export type PaymentRoute = "gateway" | "checkout" | "manual" | "none";

export function paymentRoute(sub: Subscription, now: Date = new Date()): PaymentRoute {
  if (!isManagedPlan(sub)) return "none";
  if (hasLiveGateway(sub, now)) return "gateway";
  if (sub.status === "trialing" || sub.status === "cancelled" || isExpired(sub, now)) return "checkout";
  return "manual";
}

/**
 * The plan picked on the website, while it is still what the account would
 * pay for: nothing runs in Stripe yet (the trial, or it ended) and the plan
 * can be changed. The pay button pays this one instead of the trial's plan.
 */
export function chosenPlan(sub: Subscription, now: Date = new Date()): PlanChoice | null {
  if (!sub.chosen || paymentRoute(sub, now) !== "checkout" || changeBlock(sub, now)) return null;
  return sub.chosen;
}

// ---------------------------------------------------------------------------
// Managing payments (step 23.2)
// ---------------------------------------------------------------------------

/**
 * Stripe's Customer Portal (card, billing address, receipts) is there for a
 * subscription that runs or ran through Stripe: also once it ended, so the
 * receipts stay at hand and a failed card can be replaced.
 */
export function canOpenPortal(sub: Subscription): boolean {
  return sub.gateway === "stripe" && isManagedPlan(sub);
}

/**
 * The banner of a failed payment above the app: while Stripe retries (past
 * due, the app runs as before), for the owner in their own workspace only; a
 * worker never sees it. Once Stripe gives up the subscription is cancelled
 * and expired, and the read-only card says the rest.
 */
export function showPastDueBanner(
  sub: Subscription | null,
  viewer: { worker: boolean },
  now: Date = new Date(),
): boolean {
  if (viewer.worker || !sub) return false;
  return sub.status === "past_due" && isManagedPlan(sub) && !isExpired(sub, now);
}

// ---------------------------------------------------------------------------
// Changing the plan
// ---------------------------------------------------------------------------

export type PlanChoice = { planKey: PaidPlanKey; billing: Billing };
export type ChangeDirection = "upgrade" | "downgrade" | "same";
export type ChangeTiming = "immediate" | "scheduled" | "none";

const rank = (key: PaidPlanKey) => PAID_PLAN_KEYS.indexOf(key);

/** A higher plan is up; on the same plan a year instead of a month is up. */
export function changeDirection(from: PlanChoice, to: PlanChoice): ChangeDirection {
  if (rank(to.planKey) !== rank(from.planKey)) {
    return rank(to.planKey) > rank(from.planKey) ? "upgrade" : "downgrade";
  }
  if (to.billing === from.billing) return "same";
  return to.billing === "yearly" ? "upgrade" : "downgrade";
}

export type ChangeBlock = "beta" | "cancelPending";

/** Why the plan cannot be changed from the page, or null. */
export function changeBlock(sub: Subscription, now: Date = new Date()): ChangeBlock | null {
  if (!isManagedPlan(sub)) return "beta";
  if (sub.cancelAtPeriodEnd && !isExpired(sub, now)) return "cancelPending";
  return null;
}

export type PlannedChange = {
  direction: ChangeDirection;
  timing: ChangeTiming;
  /** When a scheduled change takes effect. */
  at: string | null;
};

/**
 * What choosing `to` does, as subscription_request_change() decides: up now,
 * down at the end of the period, the current plan drops a scheduled change.
 * Without a period end, or once expired, any change is now.
 */
export function plannedChange(
  sub: Subscription & { planKey: PaidPlanKey },
  to: PlanChoice,
  now: Date = new Date(),
): PlannedChange {
  const direction = changeDirection({ planKey: sub.planKey, billing: sub.billing }, to);
  if (direction === "same") return { direction, timing: "none", at: null };
  const end = periodEndOf(sub);
  if (direction === "upgrade" || isExpired(sub, now) || end === null || passed(end, now)) {
    return { direction, timing: "immediate", at: null };
  }
  return { direction, timing: "scheduled", at: end };
}

// ---------------------------------------------------------------------------
// Cancelling
// ---------------------------------------------------------------------------

/** A catalog plan that runs and has an end can be cancelled for that end. */
export function canCancel(sub: Subscription, now: Date = new Date()): boolean {
  return (
    isManagedPlan(sub) && !sub.cancelAtPeriodEnd && !isExpired(sub, now) && periodEndOf(sub) !== null
  );
}

export function canResume(sub: Subscription, now: Date = new Date()): boolean {
  return sub.cancelAtPeriodEnd && !isExpired(sub, now);
}

/**
 * The next payment a gateway would take: the end of a paid period that goes
 * on, for the plan in force then (a scheduled downgrade included). None while
 * trialing, cancelled, expired or open-ended.
 */
export function nextPayment(
  sub: Subscription,
  now: Date = new Date(),
): { at: string; planKey: string; billing: Billing } | null {
  if (!isManagedPlan(sub) || sub.cancelAtPeriodEnd || isExpired(sub, now)) return null;
  if (sub.status !== "active" && sub.status !== "past_due") return null;
  if (!sub.periodEnd || passed(sub.periodEnd, now)) return null;
  const next = sub.scheduled ?? { planKey: sub.planKey, billing: sub.billing };
  return { at: sub.periodEnd, planKey: next.planKey, billing: next.billing };
}

// ---------------------------------------------------------------------------
// What a lower plan would not hold
// ---------------------------------------------------------------------------

export type PlanUsage = {
  /** Workers who are not deactivated. */
  workers: number;
  storageBytes: number;
  /** This calendar month, in the owner's zone. */
  monthlyContacts: number;
  aiCalls: number;
  aiFiles: number;
};

export type LimitOverage = {
  limit: PlanLimitKey;
  used: number;
  allowed: number;
  /** Over this one the workspace becomes read-only (CLAUDE.md, Tarify). */
  locks: boolean;
};

const MB = 1_048_576;

/**
 * The limits of a plan the account's data already exceeds. Workers and
 * storage make the workspace read-only from the next midnight; the monthly
 * counts only stop new contacts or answers until the month ends.
 */
export function limitOverages(limits: PlanLimits, usage: PlanUsage): LimitOverage[] {
  const out: LimitOverage[] = [];
  if (limits.workers !== null && usage.workers > limits.workers) {
    out.push({ limit: "workers", used: usage.workers, allowed: limits.workers, locks: true });
  }
  if (limits.storage_mb !== null && usage.storageBytes > limits.storage_mb * MB) {
    out.push({
      limit: "storage_mb",
      used: Math.ceil(usage.storageBytes / MB),
      allowed: limits.storage_mb,
      locks: true,
    });
  }
  const monthly: [PlanLimitKey, number][] = [
    ["monthly_contacts", usage.monthlyContacts],
    ["ai_calls", usage.aiCalls],
    ["ai_files", usage.aiFiles],
  ];
  for (const [limit, used] of monthly) {
    const allowed = limits[limit] as number;
    if (used > allowed) out.push({ limit, used, allowed, locks: false });
  }
  return out;
}
