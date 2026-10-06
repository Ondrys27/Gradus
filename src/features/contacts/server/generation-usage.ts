import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayIsoDate, zonedWallClockToInstant, type FormatSettings } from "@/lib/format";
import type { Database, Json } from "@/types/database";
import { USAGE_EVENT, type GenerationUsage } from "../generation";

type Client = SupabaseClient<Database>;

/** A month of usage events is a few hundred rows; this only bounds the query. */
const EVENT_LIMIT = 5000;

/**
 * Daily and monthly limits of the workspace owner's plan from current_plan()
 * (the default plan without a subscription, 0 once the trial has ended). Read
 * with the admin client: the id comes from the database, not the request.
 */
async function loadLimits(admin: Client, workspaceId: string) {
  const { data, error } = await admin.rpc("current_plan", { _user_id: workspaceId });
  if (error) throw error;
  const plan = data?.[0];
  return {
    daily: plan?.daily_generation_limit ?? 0,
    monthly: plan?.monthly_generation_limit ?? 0,
  };
}

/**
 * Contacts generated in the workspace today and this month, days and months
 * counted in the user's zone. usage_events is server-only, so the admin client
 * reads it, filtered by the workspace id the database gave for the session.
 */
export async function loadGenerationUsage(
  admin: Client,
  workspaceId: string,
  settings: FormatSettings,
  now: Date = new Date(),
): Promise<GenerationUsage> {
  const today = todayIsoDate(settings, now);
  const dayStart = zonedWallClockToInstant(today, "00:00", settings.timeZone);
  const monthStart = zonedWallClockToInstant(`${today.slice(0, 8)}01`, "00:00", settings.timeZone);

  const [limits, events] = await Promise.all([
    loadLimits(admin, workspaceId),
    admin
      .from("usage_events")
      .select("quantity, created_at")
      .eq("user_id", workspaceId)
      .eq("event_type", USAGE_EVENT)
      .gte("created_at", monthStart.toISOString())
      .limit(EVENT_LIMIT),
  ]);
  if (events.error) throw events.error;

  let daily = 0;
  let monthly = 0;
  for (const event of events.data) {
    monthly += event.quantity;
    if (new Date(event.created_at) >= dayStart) daily += event.quantity;
  }
  return {
    daily: { used: daily, limit: limits.daily },
    monthly: { used: monthly, limit: limits.monthly },
  };
}

/** Every call to Google is logged, failures too, with the HTTP status and Google's message. */
export async function logGenerationCall(
  admin: Client,
  workspaceId: string,
  entry: { success: boolean; quantity: number; message?: string | null; metadata: Json },
) {
  const { error } = await admin.from("usage_events").insert({
    user_id: workspaceId,
    event_type: USAGE_EVENT,
    success: entry.success,
    quantity: entry.quantity,
    message: entry.message ?? null,
    metadata: entry.metadata,
  });
  // A lost log line must not hide the result from the user; it shows in the server log.
  if (error) console.error("usage_events insert failed", error);
}
