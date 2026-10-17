/**
 * Jarvis's monthly budget. The model runs on API credits with a monthly
 * allowance, shared by every account (internal ones too). The month is the
 * calendar month in UTC, the way the API counts it. Pure: the spend itself is
 * read on the server (server/budget.ts).
 */

/**
 * The default cap while the administration has not set one (caps.ts):
 * JARVIS_MONTHLY_BUDGET_USD, or this when unset, a reserve below the 100 USD of credits.
 */
export const DEFAULT_MONTHLY_BUDGET_USD = 90;
/** The default warning threshold: from this share of the budget on, the owner gets one e-mail a day. */
export const NEAR_LIMIT_SHARE = 0.8;

/** ok, near the limit (≥ the warning threshold), or paused (≥ 100 %: no model calls until the month ends). */
export type BudgetStatus = "ok" | "near" | "paused";

export function monthlyBudgetUsd(raw: string | undefined): number {
  const value = Number(raw);
  return raw?.trim() && Number.isFinite(value) && value > 0 ? value : DEFAULT_MONTHLY_BUDGET_USD;
}

export function budgetStatus(
  spentUsd: number,
  budgetUsd: number,
  warnShare: number = NEAR_LIMIT_SHARE,
): BudgetStatus {
  if (spentUsd >= budgetUsd) return "paused";
  if (spentUsd >= budgetUsd * warnShare) return "near";
  return "ok";
}

export function utcMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function utcNextMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

const DAY_MS = 86_400_000;

/**
 * The month's spend at the pace so far. The elapsed time counts as at least
 * one day, so the first hours of a month do not project a huge number.
 */
export function projectedMonthSpend(spentUsd: number, now: Date): number {
  const start = utcMonthStart(now).getTime();
  const monthMs = utcNextMonthStart(now).getTime() - start;
  const elapsedMs = Math.min(Math.max(now.getTime() - start, DAY_MS), monthMs);
  return (spentUsd * monthMs) / elapsedMs;
}

export type BudgetSnapshot = {
  spentUsd: number;
  budgetUsd: number;
  /** Model calls this month, failed ones included. */
  calls: number;
  /** Spent / budget, 0–∞; 1 when the budget is 0. */
  share: number;
  /** The warning threshold as a share of the budget. */
  warnShare: number;
  projectedUsd: number;
  status: BudgetStatus;
};

export function budgetSnapshot(
  usage: { spentUsd: number; calls: number },
  budgetUsd: number,
  now: Date,
  warnShare: number = NEAR_LIMIT_SHARE,
): BudgetSnapshot {
  return {
    spentUsd: usage.spentUsd,
    budgetUsd,
    calls: usage.calls,
    share: budgetUsd > 0 ? usage.spentUsd / budgetUsd : 1,
    warnShare,
    projectedUsd: projectedMonthSpend(usage.spentUsd, now),
    status: budgetStatus(usage.spentUsd, budgetUsd, warnShare),
  };
}
