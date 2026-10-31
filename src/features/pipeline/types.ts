import type { Database } from "@/types/database";
import type { Tone } from "@/components/ui/tone";

type Tables = Database["public"]["Tables"];

export const STAGE_COLUMNS =
  "id, name, color, position, is_won, is_lost, system_key, deposit_percent";
export const DEAL_COLUMNS =
  "id, contact_id, stage_id, title, description, value, currency, expected_close_date, deadline_date, assignee_id, created_by, last_activity_at, position, entered_stage_at, won_at, lost_at, lost_reason, created_at, contact:contacts(id, company_name, first_name, last_name)";
/** Activities tied to one deal (e.g. an e-mail sent from its detail), oldest last. */
export const DEAL_ACTIVITY_COLUMNS = "id, type, content, occurred_at";

export type Stage = Pick<
  Tables["pipeline_stages"]["Row"],
  "id" | "name" | "color" | "position" | "is_won" | "is_lost" | "system_key" | "deposit_percent"
>;

export type DealContact = Pick<
  Tables["contacts"]["Row"],
  "id" | "company_name" | "first_name" | "last_name"
>;

export type DealActivity = Pick<
  Tables["contact_activities"]["Row"],
  "id" | "type" | "content" | "occurred_at"
>;

export type Deal = Pick<
  Tables["deals"]["Row"],
  | "id"
  | "contact_id"
  | "stage_id"
  | "title"
  | "description"
  | "value"
  | "currency"
  | "expected_close_date"
  | "deadline_date"
  | "assignee_id"
  | "created_by"
  | "last_activity_at"
  | "position"
  | "entered_stage_at"
  | "won_at"
  | "lost_at"
  | "lost_reason"
  | "created_at"
> & { contact: DealContact | null };

/** The contacts of a deal (deal_contacts), the primary one first. */
export const DEAL_CONTACT_COLUMNS =
  "id, contact_id, note, is_primary, position, created_at, created_by, contact:contacts(id, company_name, first_name, last_name, email)";

export type DealContactLink = Pick<
  Tables["deal_contacts"]["Row"],
  "id" | "contact_id" | "note" | "is_primary" | "position" | "created_at" | "created_by"
> & {
  /** Null when the viewer may not see contacts. */
  contact: (DealContact & { email: string | null }) | null;
};

/** What the database logged about a deal: stage, value and Close Date changes. */
export const DEAL_EVENT_COLUMNS = "id, kind, payload, actor_id, occurred_at";
export type DealEventRow = Pick<
  Tables["deal_events"]["Row"],
  "id" | "kind" | "payload" | "actor_id" | "occurred_at"
>;

/** Appointments of a deal shown in its history (its own deadline event is the deal itself). */
export const DEAL_MEETING_COLUMNS = "id, title, kind, starts_at, all_day, actor_id";
export type DealMeeting = Pick<
  Tables["calendar_events"]["Row"],
  "id" | "title" | "kind" | "starts_at" | "all_day" | "actor_id"
>;

/** Invoices of a deal in its history; the amounts are not shown there. */
export const DEAL_INVOICE_COLUMNS =
  "id, number, kind, status, issued_on, sent_at, paid_on, cancelled_at";
export type DealInvoice = Pick<
  Tables["invoices"]["Row"],
  "id" | "number" | "kind" | "status" | "issued_on" | "sent_at" | "paid_on" | "cancelled_at"
>;

/** Colours a stage can have. They are design tones, so no hex ever reaches a component. */
export const STAGE_TONES = ["violet", "teal", "gold", "green", "pink", "neutral"] as const;

/** Stages saved with a colour that is not a tone (the seed's "blue") show as neutral. */
export function stageTone(color: string): Tone {
  return (STAGE_TONES as readonly string[]).includes(color) ? (color as Tone) : "neutral";
}

export type StageKind = "open" | "won" | "lost";
