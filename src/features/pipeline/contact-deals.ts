import { contactName, type NameParts } from "@/features/contacts/types";
import { TITLE_MAX } from "./schemas";
import type { Stage } from "./types";

/**
 * Deals seen from a contact: its list in the contact's detail, the open deal
 * linked from a Cold Calling row, and the starting values of a deal made
 * from a contact. Pure, so the rules are tested on their own.
 */

/** Tables after which Cold Calling offers to make a deal (by system_key). */
export const DEAL_OFFER_TABLE_KEYS = ["meeting_scheduled", "interested"] as const;

export function offersDeal(systemKey: string | null | undefined): boolean {
  return (DEAL_OFFER_TABLE_KEYS as readonly (string | null | undefined)[]).includes(systemKey);
}

/** Stages a new deal from a contact can start in: the open ones, in board order. */
export function openStages<T extends Pick<Stage, "position" | "is_won" | "is_lost">>(
  stages: T[],
): T[] {
  return stages
    .filter((stage) => !stage.is_won && !stage.is_lost)
    .sort((a, b) => a.position - b.position);
}

/**
 * The stage a deal from Cold Calling lands in: the one picked in the settings
 * while it is still an open stage of this pipeline, else the first open one.
 */
export function startingStageId(
  stages: Pick<Stage, "id" | "position" | "is_won" | "is_lost">[],
  preferred: string | null | undefined,
): string | null {
  const open = openStages(stages);
  return open.find((stage) => stage.id === preferred)?.id ?? open[0]?.id ?? null;
}

/** A deal named after its contact: the company, else the person. */
export function dealTitleFor(contact: NameParts): string {
  return contactName(contact).trim().slice(0, TITLE_MAX);
}

type DealLike = {
  id: string;
  title: string;
  value: number | null;
  currency: string;
  last_activity_at: string;
  won_at: string | null;
  lost_at: string | null;
  created_at: string;
};

export function isOpenDeal(deal: Pick<DealLike, "won_at" | "lost_at">): boolean {
  return deal.won_at === null && deal.lost_at === null;
}

/** When a closed deal was won or lost; null while it is open. */
export function dealOutcome(
  deal: Pick<DealLike, "won_at" | "lost_at">,
): { kind: "won" | "lost"; at: string } | null {
  if (deal.won_at) return { kind: "won", at: deal.won_at };
  if (deal.lost_at) return { kind: "lost", at: deal.lost_at };
  return null;
}

/** Open deals first, the most recently active on top; then the history, newest close first. */
export function sortContactDeals<T extends DealLike>(deals: T[]): T[] {
  return [...deals].sort((a, b) => {
    const aOpen = isOpenDeal(a);
    const bOpen = isOpenDeal(b);
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    if (aOpen) return b.last_activity_at.localeCompare(a.last_activity_at);
    const aClosed = dealOutcome(a)!.at;
    const bClosed = dealOutcome(b)!.at;
    return bClosed.localeCompare(aClosed) || b.created_at.localeCompare(a.created_at);
  });
}

export type CurrencyTotal = { currency: string; total: number };

/** Sums by currency, never across them; a deal without an amount adds nothing. */
function totalsByCurrency(deals: DealLike[]): CurrencyTotal[] {
  const totals = new Map<string, number>();
  for (const deal of deals) {
    if (deal.value === null) continue;
    totals.set(deal.currency, (totals.get(deal.currency) ?? 0) + Number(deal.value));
  }
  return [...totals]
    .map(([currency, total]) => ({ currency, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total || a.currency.localeCompare(b.currency));
}

export type ContactDealSummary = {
  openCount: number;
  openValue: CurrencyTotal[];
  wonCount: number;
  wonValue: CurrencyTotal[];
};

/** The line above a contact's deals: how many are open, what they are worth, what was won. */
export function summarizeContactDeals(deals: DealLike[]): ContactDealSummary {
  const open = deals.filter(isOpenDeal);
  const won = deals.filter((deal) => deal.won_at !== null);
  return {
    openCount: open.length,
    openValue: totalsByCurrency(open),
    wonCount: won.length,
    wonValue: totalsByCurrency(won),
  };
}

type OpenDealLink = {
  contact_id: string;
  deal: { id: string; title: string; created_at: string } | null;
};

/** The newest open deal of each contact, for the link in its Cold Calling row. */
export function newestOpenDealByContact(
  links: OpenDealLink[],
): Record<string, { id: string; title: string }> {
  const newest: Record<string, { id: string; title: string; created_at: string }> = {};
  for (const { contact_id, deal } of links) {
    if (!deal) continue;
    const current = newest[contact_id];
    if (!current || deal.created_at > current.created_at) newest[contact_id] = deal;
  }
  return Object.fromEntries(
    Object.entries(newest).map(([contactId, deal]) => [contactId, { id: deal.id, title: deal.title }]),
  );
}
