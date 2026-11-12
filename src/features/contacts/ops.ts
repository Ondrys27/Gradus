import type { OpsEnv } from "@/lib/ops";
import { moveContact } from "./move-contact";
import { answersToSave, shownFields, type Answers } from "./move-form";
import type { ActivityInput, ContactInput } from "./schemas";
import {
  ACTIVITY_COLUMNS,
  CONTACT_COLUMNS,
  MEETING_FIELD_KEY,
  type Activity,
  type Contact,
  type ContactField,
  type ContactTable,
} from "./types";

/**
 * The writes of Contacts, shared by the screens (queries.ts, the move
 * dialog) and Grady's tools. The database fills phone_normalized, puts a new
 * contact into Unreached and keeps a contact in exactly one table.
 */

export type ContactWhere = "contacts" | "pipeline" | "onboarding" | "grady";

/** Which fields a contact has filled, for "how complete are contacts" (never the values). */
export function contactFilled(row: Pick<Contact, "email" | "phone" | "website">) {
  return {
    has_email: Boolean(row.email),
    has_phone: Boolean(row.phone),
    has_website: Boolean(row.website),
  };
}

export async function createContact(
  env: OpsEnv,
  args: {
    workspaceId: string;
    input: ContactInput & { notes?: string | null };
    where: ContactWhere;
  },
): Promise<Contact> {
  const { data, error } = await env.db
    .from("contacts")
    .insert({ ...args.input, user_id: args.workspaceId })
    .select(CONTACT_COLUMNS)
    .single();
  if (error) throw error;
  env.track("contact_created", {
    source: data.source === "generated" || data.source === "import" ? data.source : "manual",
    where: args.where,
    ...contactFilled(data),
  });
  return data;
}

export async function updateContact(
  env: OpsEnv,
  args: {
    workspaceId: string;
    id: string;
    patch: Partial<ContactInput> & { notes?: string | null };
  },
): Promise<Contact> {
  const { data, error } = await env.db
    .from("contacts")
    .update(args.patch)
    .eq("user_id", args.workspaceId)
    .eq("id", args.id)
    .select(CONTACT_COLUMNS)
    .single();
  if (error) throw error;
  env.track("contact_updated", contactFilled(data));
  return data;
}

/** Deals keep their row but lose the contact; tasks only on this contact go with it. */
export async function deleteContact(env: OpsEnv, args: { workspaceId: string; id: string }) {
  const { error } = await env.db
    .from("contacts")
    .delete()
    .eq("user_id", args.workspaceId)
    .eq("id", args.id);
  if (error) throw error;
  env.track("contact_deleted", {});
}

/** Every activity moves the contact's last contact. */
export async function addActivity(
  env: OpsEnv,
  args: { workspaceId: string; contactId: string; input: ActivityInput },
): Promise<Activity> {
  const { data, error } = await env.db
    .from("contact_activities")
    .insert({ ...args.input, contact_id: args.contactId, user_id: args.workspaceId })
    .select(ACTIVITY_COLUMNS)
    .single();
  if (error) throw error;
  env.track("contact_activity_logged", { type: data.type });
  return data;
}

const TABLE_KEYS = [
  "unreached",
  "no_answer",
  "failed",
  "meeting_scheduled",
  "interested",
  "email_sent",
  "follow_up",
  "clients",
] as const;
const DEFAULT_REASONS = [
  "has_solution",
  "not_interested",
  "no_budget",
  "not_target_group",
  "other",
] as const;

function tableKey(table: Pick<ContactTable, "system_key"> | null) {
  if (!table) return "none" as const;
  return TABLE_KEYS.find((key) => key === table.system_key) ?? ("custom" as const);
}

export type MoveToTableArgs = {
  contactId: string;
  from: Pick<ContactTable, "system_key"> | null;
  table: Pick<ContactTable, "id" | "system_key">;
  /** The questions of the target table. */
  fields: ContactField[];
  answers: Answers;
};

/**
 * Moves a contact into a table with the answers to its questions (only
 * those shown for the answers count), through moveContact(). Recorded as
 * analytics sees a move: kinds of table, how many questions, whether a
 * meeting was booked and, for Unsuccessful, which default reason; the
 * answers never leave.
 */
export async function moveContactToTable(
  env: OpsEnv,
  args: MoveToTableArgs,
): Promise<{ meetingBooked: boolean }> {
  const shown = shownFields(args.fields, args.answers);
  const toSave = answersToSave(args.fields, args.answers);
  await moveContact(env.db, { contactId: args.contactId, tableId: args.table.id, answers: toSave });
  const meetingBooked = shown.some(
    (field) => field.system_key === MEETING_FIELD_KEY && field.id in toSave,
  );
  const reasonField = shown.find((field) => field.system_key === "reason");
  const answer = reasonField ? toSave[reasonField.id] : undefined;
  const reason =
    typeof answer === "string"
      ? (DEFAULT_REASONS.find((key) => key === answer) ?? ("custom" as const))
      : undefined;
  env.track("contact_moved", {
    from_table: tableKey(args.from),
    to_table: tableKey(args.table),
    questions: shown.length,
    meeting_booked: meetingBooked,
    ...(reason ? { reason } : {}),
  });
  return { meetingBooked };
}
