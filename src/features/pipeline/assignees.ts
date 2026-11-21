/**
 * The people on a deal (deal_assignees), all of them equal. The list comes
 * with the deal; a deal read without it (older reads, sample rows in tests)
 * falls back to deals.assignee_id, the mirror the database keeps.
 */

export type DealAssignee = { assignee_id: string; created_at: string };

type WithAssignees = {
  assignee_id: string | null;
  assignees?: readonly DealAssignee[] | null;
};

/** Everyone on the deal, longest-serving first. */
export function dealAssigneeIds(deal: WithAssignees): string[] {
  if (deal.assignees && deal.assignees.length > 0) {
    return [...deal.assignees]
      .sort(
        (a, b) =>
          a.created_at.localeCompare(b.created_at) || a.assignee_id.localeCompare(b.assignee_id),
      )
      .map((row) => row.assignee_id);
  }
  return deal.assignee_id ? [deal.assignee_id] : [];
}

/** Whether the person works on the deal. */
export function isOnDeal(deal: WithAssignees, userId: string): boolean {
  return dealAssigneeIds(deal).includes(userId);
}

/** The most people on one deal (deal_assignees_guard). */
export const MAX_DEAL_ASSIGNEES = 20;

/**
 * Whether a picked list may be saved: never empty, never too long, and
 * without "all deals" the person keeps themself on it (or the deal would
 * leave their sight).
 */
export function canSaveAssignees(
  next: readonly string[],
  { me, viewAll }: { me: string; viewAll: boolean },
): boolean {
  if (next.length === 0 || next.length > MAX_DEAL_ASSIGNEES) return false;
  return viewAll || next.includes(me);
}

/** Who was added and who left, for the analytics and the optimistic update. */
export function assigneeChange(before: readonly string[], after: readonly string[]) {
  const was = new Set(before);
  const now = new Set(after);
  return {
    added: after.filter((id) => !was.has(id)),
    removed: before.filter((id) => !now.has(id)),
  };
}

/** The list as the deal will hold it: those staying keep their place, new ones come last. */
export function nextAssignees(
  current: readonly DealAssignee[],
  ids: readonly string[],
  now: string,
): DealAssignee[] {
  const keep = current.filter((row) => ids.includes(row.assignee_id));
  const added = ids
    .filter((id) => !keep.some((row) => row.assignee_id === id))
    .map((id) => ({ assignee_id: id, created_at: now }));
  return [...keep, ...added];
}
