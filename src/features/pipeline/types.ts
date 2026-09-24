import type { Database } from "@/types/database";
import type { Tone } from "@/components/ui/tone";

type Tables = Database["public"]["Tables"];

export const STAGE_COLUMNS = "id, name, color, position, is_won, is_lost, system_key";
export const DEAL_COLUMNS =
  "id, contact_id, stage_id, title, description, value, currency, expected_close_date, position, entered_stage_at, won_at, lost_at, lost_reason, created_at, contact:contacts(id, company_name, first_name, last_name)";

export type Stage = Pick<
  Tables["pipeline_stages"]["Row"],
  "id" | "name" | "color" | "position" | "is_won" | "is_lost" | "system_key"
>;

export type DealContact = Pick<
  Tables["contacts"]["Row"],
  "id" | "company_name" | "first_name" | "last_name"
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
  | "position"
  | "entered_stage_at"
  | "won_at"
  | "lost_at"
  | "lost_reason"
  | "created_at"
> & { contact: DealContact | null };

/** Colours a stage can have. They are design tones, so no hex ever reaches a component. */
export const STAGE_TONES = ["violet", "teal", "gold", "green", "pink", "neutral"] as const;

/** Stages saved with a colour that is not a tone (the seed's "blue") show as neutral. */
export function stageTone(color: string): Tone {
  return (STAGE_TONES as readonly string[]).includes(color) ? (color as Tone) : "neutral";
}

export type StageKind = "open" | "won" | "lost";
