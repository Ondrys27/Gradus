import { BASE_CURRENCY, isCurrencyShape } from "@/lib/currency";
import {
  fieldErrors,
  dealSchema,
  parseAmount,
  type DealInput,
  type PipelineErrorKey,
} from "./schemas";
import type { DealContact } from "./types";

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
  /** Null: whoever makes the deal looks after it. */
  assigneeId: string | null;
};

export function defaultCurrency(userCurrency: string): string {
  return isCurrencyShape(userCurrency) ? userCurrency : BASE_CURRENCY;
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
    assigneeId: null,
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
    assignee_id: draft.assigneeId,
  });
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, errors: fieldErrors(parsed.error) };
}
