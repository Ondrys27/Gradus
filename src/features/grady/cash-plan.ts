import {
  actualValues,
  assignTransactions,
  type PlanTransaction,
} from "@/features/finance/plan/assign";
import type { LoadedPlan } from "@/features/finance/plan/load";
import {
  cashLowFinding,
  computeSheet,
  kindsOf,
  planValues,
  type CashLowFinding,
  type LowestPoint,
} from "@/features/finance/plan/sheet";
import { isWeekPast, monthWeeks, type PlanMonthKey } from "@/features/finance/plan/weeks";
import { formatCurrency, type FormatSettings, type IsoDate } from "@/lib/format";

/**
 * What Grady knows of the month plan (Finance → Month): the planned closing
 * capital, the lowest point and its week, and whether the capital is going to
 * drop below zero or below the reserve this week or later (cashLow). Only the
 * plan's own numbers and the space's transactions; nothing is guessed, and a
 * month without a plan gives nothing at all.
 */
export type CashPlan = {
  month: PlanMonthKey;
  currency: string;
  weeks: number;
  /** Weeks of the month that are over on the user's today. */
  pastWeeks: number;
  /** The planned closing capital of the month. */
  closing: number;
  /** The plan's lowest closing capital of a week. */
  lowest: LowestPoint;
  reserve: number | null;
  /** Actuals so far and the plan from now on dropping too low; null when the month is fine. */
  finding: CashLowFinding | null;
};

export function cashPlanOf(input: {
  plan: LoadedPlan;
  transactions: PlanTransaction[];
  today: IsoDate;
  categoryNames: Record<string, string[]>;
}): CashPlan | null {
  const { plan } = input;
  const record = plan.month;
  if (!record) return null;
  const weeks = monthWeeks(record.month);
  const count = weeks.length;
  const pastWeeks = weeks.filter((week) => isWeekPast(week, input.today)).length;
  const values = planValues(plan.rows, plan.cells, count);
  const sheet = computeSheet({
    weeks: count,
    opening: record.opening_capital,
    kinds: kindsOf(plan.rows),
    values,
    reserve: record.reserve,
  });
  const assignments = assignTransactions({
    month: record.month,
    currency: record.currency,
    rows: plan.rows,
    transactions: input.transactions,
    categoryNames: input.categoryNames,
  });
  const finding = cashLowFinding({
    rows: plan.rows,
    plan: values,
    actual: actualValues(assignments, plan.rows, count),
    weeks: count,
    pastWeeks,
    opening: record.opening_capital,
    reserve: record.reserve,
  });
  return {
    month: record.month,
    currency: record.currency,
    weeks: count,
    pastWeeks,
    closing: sheet.summary.closing,
    lowest: sheet.summary.lowest,
    reserve: record.reserve,
    finding,
  };
}

/** Quoted so a row name can never pass for an instruction. */
function quoted(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return JSON.stringify(flat.length > 60 ? `${flat.slice(0, 59)}…` : flat);
}

/** The plan in one or two lines of the situation summary, money in the plan's currency. */
export function describeCashPlan(plan: CashPlan, settings: FormatSettings): string {
  const money = (value: number) => formatCurrency(value, plan.currency, settings);
  const now =
    plan.pastWeeks >= plan.weeks
      ? "the month is over"
      : plan.pastWeeks === 0
        ? "the month has not started yet"
        : `week ${plan.pastWeeks + 1} is the current one`;
  const reserve = plan.reserve !== null ? `, reserve ${money(plan.reserve)}` : "";
  const lines = [
    `Finance plan ${plan.month} (${plan.weeks} weeks, Monday to Sunday; ${now}): planned closing capital ${money(plan.closing)}, lowest ${money(plan.lowest.value)} at the end of week ${plan.lowest.week}${reserve}.`,
  ];
  const finding = plan.finding;
  if (finding) {
    const below =
      finding.threshold > 0 ? `below the reserve ${money(finding.threshold)}` : "below zero";
    const cause = finding.cause
      ? ` The largest expense that week is ${quoted(finding.cause.label)} ${money(finding.cause.amount)}.`
      : "";
    const missing = finding.missingIncomes
      ? ` ${finding.missingIncomes} planned income(s) from past weeks have not (fully) come in.`
      : "";
    lines.push(
      `Cash warning: with the actuals so far and the plan from now on, the capital drops to ${money(finding.closing)} at the end of week ${finding.week}, ${below}.${cause}${missing}`,
    );
  }
  return lines.join("\n");
}

/** A short, stable fingerprint of a name for the suggestion's key (not for security). */
function nameKey(value: string): string {
  let hash = 0;
  for (const char of value.normalize("NFC")) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return hash.toString(36);
}

/** The rule input of the cashLow suggestion, or null when the month is fine. */
export type CashLowInput = {
  month: PlanMonthKey;
  week: number;
  threshold: number;
  currency: string;
  cause: { label: string; amount: number } | null;
  missingIncomes: number;
};

export function cashLowInputOf(plan: CashPlan | null): CashLowInput | null {
  if (!plan?.finding) return null;
  const { finding } = plan;
  return {
    month: plan.month,
    week: finding.week,
    threshold: finding.threshold,
    currency: plan.currency,
    cause: finding.cause,
    missingIncomes: finding.missingIncomes,
  };
}

/**
 * Everything the bubble says is in the key: when the week, the threshold, the
 * cause or the missing incomes change, it is a new suggestion and the old one
 * is retired, so Grady never repeats what is no longer true.
 */
export function cashLowDedupeKey(input: CashLowInput): string {
  const cause = input.cause ? `${nameKey(input.cause.label)}-${input.cause.amount}` : "none";
  return `cashLow:${input.month}:${input.week}:${input.threshold}:${input.missingIncomes}:${cause}`;
}
