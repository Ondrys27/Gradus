import { formatPrice, type FormatSettings } from "@/lib/format";
import type { RewardTotals } from "./types";

/**
 * Rewards in Grady's picture of the situation (28.2): to whoever manages
 * rewards, who is owed what (approved, waiting for the payout) and what
 * waits for approval ("who do I owe"); to a worker, their own month. Amounts
 * per currency, never added across currencies.
 */

type Money = { currency: string; amount: number };

export type RewardsSituation = {
  /** The people whose rewards the user manages, with something owed or waiting. */
  owed: Array<{ name: string; approved: Money[]; pending: Money[] }>;
  /** The user's own rewards as a worker of this company; null in their own space. */
  own: { earned: Money[]; pending: Money[]; approved: Money[]; planned: Money[]; plannedCount: number } | null;
};

const pick = (items: readonly RewardTotals[], field: "earned" | "pending" | "approved" | "planned"): Money[] =>
  items
    .filter((item) => item[field] !== 0)
    .map((item) => ({ currency: item.currency, amount: Math.round(item[field] * 100) / 100 }));

/** The situation from reward_totals() rows (already limited by row level security). */
export function rewardsSituation(input: {
  totals: readonly RewardTotals[];
  /** The user's own worker record in this company; null in their own space. */
  ownWorkerId: string | null;
  names: ReadonlyMap<string, string>;
  /** How many people to name at most. */
  limit?: number;
}): RewardsSituation | null {
  const byWorker = new Map<string, RewardTotals[]>();
  for (const item of input.totals) {
    byWorker.set(item.workerId, [...(byWorker.get(item.workerId) ?? []), item]);
  }
  const owed: RewardsSituation["owed"] = [];
  for (const [workerId, items] of byWorker) {
    if (workerId === input.ownWorkerId) continue;
    const approved = pick(items, "approved");
    const pending = pick(items, "pending");
    if (approved.length === 0 && pending.length === 0) continue;
    owed.push({ name: input.names.get(workerId) ?? "?", approved, pending });
  }
  owed.sort((a, b) => b.approved.length + b.pending.length - (a.approved.length + a.pending.length) || a.name.localeCompare(b.name));
  const mine = input.ownWorkerId ? (byWorker.get(input.ownWorkerId) ?? []) : null;
  const own = mine
    ? {
        earned: pick(mine, "earned"),
        pending: pick(mine, "pending"),
        approved: pick(mine, "approved"),
        planned: pick(mine, "planned"),
        plannedCount: mine.reduce((sum, item) => sum + item.plannedCount, 0),
      }
    : null;
  if (owed.length === 0 && !own) return null;
  return { owed: owed.slice(0, input.limit ?? 10), own };
}

/** A name as data, never an instruction: quoted, on one line, at most 60 characters. */
function quoted(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return JSON.stringify(flat.length > 60 ? `${flat.slice(0, 59)}…` : flat);
}

/** Lines for the model, in English like the rest of the situation. */
export function describeRewards(situation: RewardsSituation, settings: FormatSettings): string[] {
  const money = (items: Money[]) =>
    items.map((item) => formatPrice(item.amount, item.currency, settings)).join(" + ");
  const lines: string[] = [];
  const owing = situation.owed.filter((person) => person.approved.length > 0);
  const waiting = situation.owed.filter((person) => person.pending.length > 0);
  if (owing.length > 0) {
    lines.push(
      `Worker rewards the user owes (approved, waiting for the payout): ${owing
        .map((person) => `${quoted(person.name)} ${money(person.approved)}`)
        .join("; ")} (Company → Rewards and payouts, "Mark paid").`,
    );
  }
  if (waiting.length > 0) {
    lines.push(
      `Worker rewards waiting for the user's approval: ${waiting
        .map((person) => `${quoted(person.name)} ${money(person.pending)}`)
        .join("; ")}.`,
    );
  }
  if (situation.own) {
    const { earned, pending, approved, planned, plannedCount } = situation.own;
    const parts = [
      `earned this month ${earned.length ? money(earned) : "nothing yet"}`,
      pending.length ? `waiting for approval ${money(pending)}` : null,
      approved.length ? `approved, waiting for the payout ${money(approved)}` : null,
      planned.length ? `planned (for work not done yet) ${money(planned)} in ${plannedCount} rewards` : null,
    ].filter(Boolean);
    lines.push(`The user's own rewards in this company (Rewards page): ${parts.join(", ")}.`);
  }
  return lines;
}
