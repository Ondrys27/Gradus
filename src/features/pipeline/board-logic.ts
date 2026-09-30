import { subMonths } from "date-fns";
import type { Deal, DealContact, Stage } from "./types";

/**
 * Fallback while user_settings has not loaded yet; the real value lives in
 * user_settings.reengage_after_months (Settings → Pipeline).
 */
export const DEFAULT_REENGAGE_AFTER_MONTHS = 6;

export function sortStages(stages: Stage[]): Stage[] {
  return [...stages].sort((a, b) => a.position - b.position);
}

/** Deals per stage, in board order. Deals of an unknown stage are left out. */
export function groupDealsByStage(stages: Stage[], deals: Deal[]): Map<string, Deal[]> {
  const groups = new Map<string, Deal[]>(stages.map((stage) => [stage.id, []]));
  for (const deal of deals) groups.get(deal.stage_id)?.push(deal);
  for (const list of groups.values()) {
    list.sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
  }
  return groups;
}

export type CurrencyTotal = { currency: string; total: number };

/** Amounts add up per currency; different currencies are never converted into one another. */
export function sumByCurrency(deals: Pick<Deal, "value" | "currency">[]): CurrencyTotal[] {
  const totals = new Map<string, number>();
  for (const deal of deals) {
    if (deal.value === null) continue;
    totals.set(deal.currency, (totals.get(deal.currency) ?? 0) + Number(deal.value));
  }
  return [...totals.entries()]
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Lost for longer than `reengageAfterMonths` (Settings → Pipeline) since it entered its lost stage. */
export function isRelaunchable(
  deal: Deal,
  stage: Stage | undefined,
  now: Date = new Date(),
  reengageAfterMonths: number = DEFAULT_REENGAGE_AFTER_MONTHS,
) {
  if (!stage?.is_lost) return false;
  return new Date(deal.entered_stage_at) < subMonths(now, reengageAfterMonths);
}

/** How many of a stage's own deals are relaunchable; used for the column's filter badge. */
export function countRelaunchable(
  deals: Deal[],
  stage: Stage,
  now: Date = new Date(),
  reengageAfterMonths: number = DEFAULT_REENGAGE_AFTER_MONTHS,
) {
  return deals.filter((deal) => isRelaunchable(deal, stage, now, reengageAfterMonths)).length;
}

/** A deal dropped into a stage goes to the end of it. */
export function nextDealPosition(deals: Deal[], stageId: string): number {
  let max = -1;
  for (const deal of deals) if (deal.stage_id === stageId) max = Math.max(max, deal.position);
  return max + 1;
}

export type MoveKind = "none" | "open" | "won" | "lost";

/** What moving a deal into `target` means; "lost" asks for a reason first. */
export function moveKind(deal: Deal, target: Stage | undefined): MoveKind {
  if (!target || target.id === deal.stage_id) return "none";
  if (target.is_won) return "won";
  if (target.is_lost) return "lost";
  return "open";
}

/** Optimistic view of a move. The database sets the real timestamps and the list is read again. */
export function applyMove(deals: Deal[], dealId: string, target: Stage, now: Date): Deal[] {
  const position = nextDealPosition(deals, target.id);
  const stamp = now.toISOString();
  return deals.map((deal) =>
    deal.id === dealId
      ? {
          ...deal,
          stage_id: target.id,
          position,
          entered_stage_at: stamp,
          won_at: target.is_won ? stamp : null,
          lost_at: target.is_lost ? stamp : null,
          lost_reason: target.is_lost ? deal.lost_reason : null,
        }
      : deal,
  );
}

export type PositionChange = { id: string; position: number };

/** Moves one stage to the place of another; returns only the positions that change. */
export function reorderStages(stages: Stage[], activeId: string, overId: string) {
  const sorted = sortStages(stages);
  const from = sorted.findIndex((stage) => stage.id === activeId);
  const to = sorted.findIndex((stage) => stage.id === overId);
  if (from < 0 || to < 0 || from === to) return { stages: sorted, changes: [] };
  const next = [...sorted];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  const changes: PositionChange[] = [];
  const reordered = next.map((stage, index) => {
    if (stage.position !== index) changes.push({ id: stage.id, position: index });
    return { ...stage, position: index };
  });
  return { stages: reordered, changes };
}

export function contactLabel(contact: DealContact | null): string {
  if (!contact) return "";
  const person = [contact.first_name, contact.last_name].filter(Boolean).join(" ");
  return contact.company_name || person;
}
