import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayIsoDate, zonedWallClockToInstant, type FormatSettings } from "@/lib/format";
import type { Database } from "@/types/database";
import { costUsd, type JarvisFeature, type JarvisModel, type TokenUsage } from "../models";
import type { AiCallUsage } from "../protocol";

type Client = SupabaseClient<Database>;

/** The plan's monthly number of AI calls (the default plan without a subscription). */
async function loadLimit(supabase: Client, userId: string): Promise<number> {
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("plan_key")
    .eq("user_id", userId)
    .maybeSingle();
  const query = supabase.from("plans").select("ai_calls_limit");
  const { data: plan, error } = await (
    subscription ? query.eq("key", subscription.plan_key) : query.eq("is_default", true)
  ).maybeSingle();
  if (error) throw error;
  return plan?.ai_calls_limit ?? 0;
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
  const today = todayIsoDate(settings, now);
  const monthStart = zonedWallClockToInstant(`${today.slice(0, 8)}01`, "00:00", settings.timeZone);
  const [limit, used] = await Promise.all([
    loadLimit(supabase, userId),
    admin
      .from("ai_usage")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("success", true)
      .gte("created_at", monthStart.toISOString()),
  ]);
  if (used.error) throw used.error;
  return { used: used.count ?? 0, limit };
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
