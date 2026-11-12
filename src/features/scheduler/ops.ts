import type { OpsEnv } from "@/lib/ops";
import type { Database } from "@/types/database";
import { clientInsert } from "./client-insert";

/**
 * The host's own writes of the scheduler, shared by the screens (queries.ts)
 * and Grady's tools. The guards set person and space from the profile and
 * check the plan's limit of active types; RLS keeps them to the user's own.
 */

type EventTypeUpdate = Database["public"]["Tables"]["event_types"]["Update"];
export type EventTypeTab =
  "basics" | "availability" | "questions" | "reminders" | "confirmation" | "preview";

export async function updateEventType(
  env: OpsEnv,
  args: { id: string; userId: string; patch: EventTypeUpdate; tab: EventTypeTab },
): Promise<void> {
  const { error } = await env.db
    .from("event_types")
    .update(args.patch)
    .eq("id", args.id)
    .eq("user_id", args.userId);
  if (error) throw error;
  env.track("scheduler_event_type_updated", { tab: args.tab });
}

/** On or off; the space's owner may switch somebody else's type off (never on). */
export async function setEventTypeActive(
  env: OpsEnv,
  args: { id: string; active: boolean; byOwner: boolean },
): Promise<void> {
  const { data, error } = await env.db
    .from("event_types")
    .update({ active: args.active })
    .eq("id", args.id)
    .select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("not changed");
  env.track("scheduler_event_type_toggled", { active: args.active, by_owner: args.byOwner });
}

/** Exceptions for dates: other hours, or the whole day blocked (no intervals). Returns the new rows. */
export async function addAvailabilityOverrides(
  env: OpsEnv,
  args: {
    profileId: string;
    dates: string[];
    intervals: Array<{ start_time: string; end_time: string }> | null;
  },
): Promise<string[]> {
  // A date gets the new exception instead of what it had.
  const { error: clearError } = await env.db
    .from("availability_overrides")
    .delete()
    .eq("profile_id", args.profileId)
    .in("date", args.dates);
  if (clearError) throw clearError;
  const rows = args.dates.flatMap((date) =>
    (args.intervals ?? [{ start_time: null, end_time: null }]).map(
      (interval: { start_time: string | null; end_time: string | null }) =>
        clientInsert("availability_overrides", {
          profile_id: args.profileId,
          date,
          start_time: interval.start_time,
          end_time: interval.end_time,
        }),
    ),
  );
  const { data, error } = await env.db.from("availability_overrides").insert(rows).select("id");
  if (error) throw error;
  env.track("scheduler_availability_saved", {
    scope: "override",
    intervals: Math.min(500, rows.length),
  });
  return (data ?? []).map((row) => row.id);
}
