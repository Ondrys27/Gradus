import type { Database } from "@/types/database";
import type { Tone } from "@/components/ui/tone";

type Tables = Database["public"]["Tables"];
type Views = Database["public"]["Views"];

export const LIST_COLUMNS =
  "id, company_name, first_name, last_name, email, phone, city, source, created_at, table_id, last_contact_at";
export const CONTACT_COLUMNS =
  "id, company_name, first_name, last_name, email, phone, website, address, city, postal_code, country_code, source, notes, created_at";
export const TABLE_COLUMNS = "id, name, color, position, is_system, system_key";
export const FIELD_COLUMNS =
  "id, table_id, label, type, required, options, default_value, depends_on_field_id, depends_on_value, position, system_key";
export const ACTIVITY_COLUMNS = "id, contact_id, deal_id, type, content, occurred_at, created_at";
export const CONTACT_DEAL_COLUMNS =
  "id, title, value, currency, won_at, lost_at, stage:pipeline_stages(id, name, color)";

type ListRow = Views["contact_list"]["Row"];

/** A row of the contact list. The view marks every column nullable; id and created_at never are. */
export type ContactListItem = Pick<
  ListRow,
  | "company_name"
  | "first_name"
  | "last_name"
  | "email"
  | "phone"
  | "city"
  | "source"
  | "table_id"
  | "last_contact_at"
> & { id: string; created_at: string };

export type Contact = Pick<
  Tables["contacts"]["Row"],
  | "id"
  | "company_name"
  | "first_name"
  | "last_name"
  | "email"
  | "phone"
  | "website"
  | "address"
  | "city"
  | "postal_code"
  | "country_code"
  | "source"
  | "notes"
  | "created_at"
>;

export type ContactTable = Pick<
  Tables["contact_tables"]["Row"],
  "id" | "name" | "color" | "position" | "is_system" | "system_key"
>;

export type ContactField = Pick<
  Tables["contact_table_fields"]["Row"],
  | "id"
  | "table_id"
  | "label"
  | "type"
  | "required"
  | "options"
  | "default_value"
  | "depends_on_field_id"
  | "depends_on_value"
  | "position"
  | "system_key"
>;
export type FieldType = ContactField["type"];
export const FIELD_TYPES = ["text", "long_text", "date", "datetime", "select", "boolean"] as const;
export type FieldOption = { key: string; label: string };
/** A date-and-time question with this key books a meeting in the calendar. */
export const MEETING_FIELD_KEY = "meeting_at";

export type Activity = Pick<
  Tables["contact_activities"]["Row"],
  "id" | "contact_id" | "deal_id" | "type" | "content" | "occurred_at" | "created_at"
>;
export type ActivityType = Activity["type"];
/** Types a person logs by hand; moves are recorded by the database. */
export const MANUAL_ACTIVITY_TYPES = ["call", "email", "meeting", "sms", "note"] as const;

export type ContactDeal = Pick<
  Tables["deals"]["Row"],
  "id" | "title" | "value" | "currency" | "won_at" | "lost_at"
> & { stage: { id: string; name: string; color: string } | null };

/** Colours a table can have. Design tones, never hexes. */
export const TABLE_TONES = ["violet", "teal", "gold", "green", "pink", "neutral"] as const;

/** The seed's "slate" and "blue" and anything unknown show as neutral. */
export function tableTone(color: string): Tone {
  return (TABLE_TONES as readonly string[]).includes(color) ? (color as Tone) : "neutral";
}

export type NameParts = Pick<Contact, "company_name" | "first_name" | "last_name">;

/** Company first, else the person. */
export function contactName(contact: NameParts): string {
  const person = [contact.first_name, contact.last_name].filter(Boolean).join(" ");
  return contact.company_name || person;
}

/** The person behind a company, shown under its name. */
export function contactPerson(contact: NameParts): string | null {
  if (!contact.company_name) return null;
  const person = [contact.first_name, contact.last_name].filter(Boolean).join(" ");
  return person || null;
}
