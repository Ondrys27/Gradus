import { TRIAL_URGENT_DAYS } from "@/config/pricing";

export type PlanStatus = "trialing" | "active" | "expired" | "past_due" | "cancelled";

/**
 * The plan of the workspace the account works in, as current_plan() reports
 * it. `readOnly` is decided by the database, which also enforces it.
 */
export type PlanSnapshot = {
  planKey: string;
  status: PlanStatus;
  trialEndsAt: string | null;
  readOnly: boolean;
};

/** Used only when the plan cannot be read: never locks anyone out by mistake. */
export const UNKNOWN_PLAN: PlanSnapshot = {
  planKey: "beta",
  status: "active",
  trialEndsAt: null,
  readOnly: false,
};

const STATUSES: readonly PlanStatus[] = ["trialing", "active", "expired", "past_due", "cancelled"];

export function toPlanSnapshot(
  row: { plan_key: string; status: string; trial_ends_at: string | null; read_only: boolean } | null,
): PlanSnapshot {
  if (!row) return UNKNOWN_PLAN;
  return {
    planKey: row.plan_key,
    status: (STATUSES as readonly string[]).includes(row.status)
      ? (row.status as PlanStatus)
      : "active",
    trialEndsAt: row.trial_ends_at,
    readOnly: row.read_only,
  };
}

export type TrialNotice =
  | { kind: "none" }
  | { kind: "trial"; daysLeft: number; urgent: boolean }
  | { kind: "expired" }
  /** Read-only while the trial runs or the plan is paid: more workers or storage than the plan allows. */
  | { kind: "overLimit" };

const DAY_MS = 86_400_000;

/** The trial is over, by the database's word or by the clock since it last answered. */
function trialOver(plan: PlanSnapshot, now: Date): boolean {
  if (plan.status === "expired") return true;
  return (
    plan.status === "trialing" &&
    !!plan.trialEndsAt &&
    Date.parse(plan.trialEndsAt) - now.getTime() <= 0
  );
}

/**
 * What the app shows above the content: a quiet bar while the trial runs
 * (louder in the last days), a card once it ended, a card when the workspace
 * is read-only for being over its plan's limits, nothing otherwise.
 * Days left count started days, so the last 24 hours read "1 day".
 */
export function trialNotice(plan: PlanSnapshot, now: Date = new Date()): TrialNotice {
  if (trialOver(plan, now)) return { kind: "expired" };
  // current_plan() says 'expired' whenever the trial is over, so read-only
  // without it means the account holds more than its plan allows.
  if (plan.readOnly) return { kind: "overLimit" };
  if (plan.status !== "trialing" || !plan.trialEndsAt) return { kind: "none" };
  const msLeft = Date.parse(plan.trialEndsAt) - now.getTime();
  const daysLeft = Math.ceil(msLeft / DAY_MS);
  return { kind: "trial", daysLeft, urgent: daysLeft <= TRIAL_URGENT_DAYS };
}
