import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayIsoDate, zonedWallClockToInstant, type FormatSettings } from "@/lib/format";
import type { Database } from "@/types/database";
import { costUsd, type JarvisFeature, type JarvisModel, type TokenUsage } from "../models";
import type { AiCallUsage } from "../protocol";

type Client = SupabaseClient<Database>;

type PlanLimits = { aiCalls: number; fileUploads: number };

type PlanRow = { ai_calls_limit: number; file_uploads_limit: number; read_only: boolean };

/**
 * The monthly numbers from current_plan(), which already falls back to the
 * default plan without a subscription and gives 0 once a trial has ended.
 */
export function planLimits(row: PlanRow | null | undefined): PlanLimits {
  return { aiCalls: row?.ai_calls_limit ?? 0, fileUploads: row?.file_uploads_limit ?? 0 };
}

/** The plan's monthly numbers, read with the user's own client. */
async function loadLimits(supabase: Client, userId: string): Promise<PlanLimits> {
  const { data, error } = await supabase.rpc("current_plan", { _user_id: userId });
  if (error) throw error;
  const row = data?.[0];
  const limits = planLimits(row);
  if (limits.aiCalls === 0 && !row?.read_only)
    console.error("jarvis: no plan applies to user", userId);
  return limits;
}

/** Start of the user's calendar month as an instant. */
function monthStart(settings: FormatSettings, now: Date): string {
  const today = todayIsoDate(settings, now);
  return zonedWallClockToInstant(
    `${today.slice(0, 8)}01`,
    "00:00",
    settings.timeZone,
  ).toISOString();
}

/**
 * Answered AI calls this calendar month, the month counted in the user's zone.
 * Failed calls are logged but do not use up the plan. ai_usage is server-only,
 * so the admin client reads it, filtered by the user id from the session.
 */
export async function loadAiUsage(
  supabase: Client,
  admin: Client,
  userId: string,
  settings: FormatSettings,
  now: Date = new Date(),
): Promise<AiCallUsage> {
  const [limits, used] = await Promise.all([
    loadLimits(supabase, userId),
    admin
      .from("ai_usage")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("success", true)
      .gte("created_at", monthStart(settings, now)),
  ]);
  if (used.error) throw used.error;
  return { used: used.count ?? 0, limit: limits.aiCalls };
}

/** Every accepted file is one of these analytics events. */
export const FILE_ATTACHED_EVENT = "jarvis_file_attached";

/**
 * Files attached to Jarvis this month and the plan's number. analytics_events
 * is server-only, read with the admin client filtered by the session's user id.
 */
export async function loadFileUsage(
  supabase: Client,
  admin: Client,
  userId: string,
  settings: FormatSettings,
  now: Date = new Date(),
): Promise<{ used: number; limit: number }> {
  const [limits, used] = await Promise.all([
    loadLimits(supabase, userId),
    admin
      .from("analytics_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("event", FILE_ATTACHED_EVENT)
      .gte("created_at", monthStart(settings, now)),
  ]);
  if (used.error) throw used.error;
  return { used: used.count ?? 0, limit: limits.fileUploads };
}

export function limitReached(usage: AiCallUsage): boolean {
  return usage.used >= usage.limit;
}

export type AiUsageEntry = {
  userId: string;
  conversationId: string | null;
  feature: JarvisFeature;
  model: JarvisModel;
  tokens: TokenUsage;
  durationMs: number;
  error?: string | null;
};

/** One row per model call, written right when the call ends, failures included. */
export async function logAiUsage(admin: Client, entry: AiUsageEntry): Promise<void> {
  const { error } = await admin.from("ai_usage").insert({
    user_id: entry.userId,
    conversation_id: entry.conversationId,
    purpose: entry.feature,
    model: entry.model,
    input_tokens: entry.tokens.inputTokens,
    cache_read_tokens: entry.tokens.cacheReadTokens,
    cache_write_tokens: entry.tokens.cacheWriteTokens,
    output_tokens: entry.tokens.outputTokens,
    cost_usd: costUsd(entry.model, entry.tokens),
    duration_ms: Math.round(entry.durationMs),
    success: !entry.error,
    error: entry.error ? entry.error.slice(0, 1000) : null,
  });
  // A lost log line must not hide the answer from the user; it shows in the server log.
  if (error) console.error("ai_usage insert failed", error);
}
