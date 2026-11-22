import type { Worker } from "../types";

/**
 * Who Rewards and payouts lists (28.1): the people of the company now (the
 * shared activeMembers list), and with "Show former too" also those who
 * worked there and left or were removed, for their payout history. Never
 * an invite nobody accepted.
 */
export type RosterEntry = { worker: Worker; former: boolean };

export function rewardsRoster(
  workers: readonly Worker[],
  activeIds: ReadonlySet<string>,
  showFormer: boolean,
): RosterEntry[] {
  const current = workers.filter((worker) => activeIds.has(worker.id));
  const former = showFormer ? workers.filter((worker) => isFormer(worker, activeIds)) : [];
  return [
    ...current.map((worker) => ({ worker, former: false })),
    ...former.map((worker) => ({ worker, former: true })),
  ];
}

/** Worked in the company (an account joined) and is no longer there. */
export function isFormer(worker: Pick<Worker, "id" | "status" | "user_id">, activeIds: ReadonlySet<string>) {
  return worker.status === "inactive" && worker.user_id !== null && !activeIds.has(worker.id);
}

/** How many former people there are, for the switch. */
export function formerCount(workers: readonly Worker[], activeIds: ReadonlySet<string>): number {
  return workers.filter((worker) => isFormer(worker, activeIds)).length;
}
