import { CURRENCIES } from "@/lib/format";
import {
  fieldErrors,
  dealSchema,
  parseAmount,
  type DealInput,
  type PipelineErrorKey,
} from "./schemas";
import type { Deal, DealContact } from "./types";

/** What the deal form holds while it is being edited: text as typed, the contact as a whole. */
export type DealDraft = {
  title: string;
  contact: DealContact | null;
  value: string;
  currency: string;
  closeDate: string | null;
  stageId: string;
  description: string;
  lostReason: string;
};

export function defaultCurrency(userCurrency: string): string {
  return (CURRENCIES as readonly string[]).includes(userCurrency) ? userCurrency : CURRENCIES[0];
}

export function emptyDraft(stageId: string, currency: string): DealDraft {
  return {
    title: "",
    contact: null,
    value: "",
    currency,
    closeDate: null,
    stageId,
    description: "",
    lostReason: "",
  };
}

export function draftFromDeal(deal: Deal): DealDraft {
  return {
    title: deal.title,
    contact: deal.contact,
    value: deal.value === null ? "" : String(Number(deal.value)).replace(".", ","),
    currency: deal.currency,
    closeDate: deal.expected_close_date,
    stageId: deal.stage_id,
    description: deal.description ?? "",
    lostReason: deal.lost_reason ?? "",
  };
}

export type DraftResult =
  { ok: true; data: DealInput } | { ok: false; errors: Partial<Record<string, PipelineErrorKey>> };

export function validateDraft(draft: DealDraft): DraftResult {
  const parsed = dealSchema.safeParse({
    title: draft.title,
    contact_id: draft.contact?.id ?? null,
    value: parseAmount(draft.value),
    currency: draft.currency,
    expected_close_date: draft.closeDate,
    stage_id: draft.stageId,
    description: draft.description,
    lost_reason: draft.lostReason,
  });
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, errors: fieldErrors(parsed.error) };
}
