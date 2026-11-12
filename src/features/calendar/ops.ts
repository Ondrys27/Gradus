import type { OpsEnv } from "@/lib/ops";
import type { Database } from "@/types/database";
import type { EventInput } from "./schemas";

/**
 * The writes of the calendar, shared by the screens (queries.ts) and Grady's
 * tools. A deal's delivery-date event belongs to the database alone; the
 * guard refuses a change of it from here.
 */

export function toEventRow(input: EventInput) {
  return {
    title: input.title,
    kind: input.kind,
    starts_at: input.starts_at,
    ends_at: input.ends_at,
    all_day: input.all_day,
    description: input.description || null,
    contact_id: input.contact_id,
    deal_id: input.deal_id,
  };
}

export type EventRow = ReturnType<typeof toEventRow>;

export async function createEvent(
  env: OpsEnv,
  args: { workspaceId: string; input: EventInput },
): Promise<{ id: string }> {
  const { data, error } = await env.db
    .from("calendar_events")
    .insert({ ...toEventRow(args.input), user_id: args.workspaceId })
    .select("id")
    .single();
  if (error) throw error;
  env.track("calendar_event_created", {
    kind: args.input.kind,
    has_contact: Boolean(args.input.contact_id),
  });
  return data;
}

/** `patch` may be a bare time range (a drag); `kind` names the event for analytics. */
export async function updateEvent(
  env: OpsEnv,
  args: {
    id: string;
    patch: Partial<EventRow>;
    kind: Database["public"]["Enums"]["calendar_event_kind"] | null;
  },
): Promise<void> {
  const { error } = await env.db.from("calendar_events").update(args.patch).eq("id", args.id);
  if (error) throw error;
  const kind = args.patch.kind ?? args.kind;
  if (kind) env.track("calendar_event_updated", { kind });
}

/** Deleting an event never touches the contact or the deal it points to. */
export async function deleteEvent(env: OpsEnv, id: string): Promise<void> {
  const { error } = await env.db.from("calendar_events").delete().eq("id", id);
  if (error) throw error;
  env.track("calendar_event_deleted", {});
}
