import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayIsoDate, zonedWallClockToInstant, type FormatSettings } from "@/lib/format";
import { track } from "@/lib/analytics/track";
import type { Database } from "@/types/database";
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
 * counted in the user's zone, summed from the `saved` of every Google request.
 * analytics_events is server-only, so the admin client reads it, filtered by
 * the workspace (owner_id) the database gave for the session.
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
      .from("analytics_events")
      .select("props, created_at")
      .eq("owner_id", workspaceId)
      .eq("event", USAGE_EVENT)
      .gte("created_at", monthStart.toISOString())
      .limit(EVENT_LIMIT),
  ]);
  if (events.error) throw events.error;

  let daily = 0;
  let monthly = 0;
  for (const event of events.data) {
    const saved = Number((event.props as { saved?: unknown } | null)?.saved ?? 0);
    const quantity = Number.isFinite(saved) && saved > 0 ? saved : 0;
    monthly += quantity;
    if (new Date(event.created_at) >= dayStart) daily += quantity;
  }
  return {
    daily: { used: daily, limit: limits.daily },
    monthly: { used: monthly, limit: limits.monthly },
  };
}

export type PlacesRequestLog = {
  page?: number;
  ok: boolean;
  saved: number;
  results?: number;
  duplicates?: number;
  httpStatus?: number;
  errorCode?: string;
};

/**
 * Every call to Google is recorded, failures too, with the HTTP status and
 * the error code (Google's message stays in the server log, never in the data).
 * The event belongs to the person who pressed the button, in their workspace.
 */
export async function logGenerationCall(
  admin: Client,
  actorId: string,
  workspaceId: string,
  entry: PlacesRequestLog,
) {
  await track(
    USAGE_EVENT,
    {
      ok: entry.ok,
      saved: entry.saved,
      ...(entry.page !== undefined ? { page: entry.page } : {}),
      ...(entry.results !== undefined ? { results: entry.results } : {}),
      ...(entry.duplicates !== undefined ? { duplicates: entry.duplicates } : {}),
      ...(entry.httpStatus ? { http_status: entry.httpStatus } : {}),
      ...(entry.errorCode ? { error_code: entry.errorCode } : {}),
    },
    { userId: actorId, ownerId: workspaceId, admin },
  );
}

/**
 * The searched industry for the "most searched" overview: lower case, no
 * accents, one space, at most 40 characters, and kept without any link to a
 * person or a day's user.
 */
export function normalizeKeyword(industry: string): string | null {
  const keyword = industry
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\d{5,}/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .trim();
  return keyword.length >= 2 ? keyword : null;
}

export async function countKeyword(admin: Client, industry: string) {
  const keyword = normalizeKeyword(industry);
  if (!keyword) return;
  const { error } = await admin.rpc("count_generation_keyword", { _keyword: keyword });
  if (error) console.error("[generation] keyword count failed", error.code);
}
