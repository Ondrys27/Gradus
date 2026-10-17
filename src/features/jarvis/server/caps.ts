import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { resolveAiCaps, type AiCaps, type UserCapOverride } from "../caps";

type Client = SupabaseClient<Database>;

/**
 * How long a server instance reuses the caps it read. Changes in the
 * administration apply within this time on every instance (the instance that
 * saved them forgets its copy at once).
 */
export const CAPS_TTL_MS = 30_000;
/** The per-user cache is dropped whole once it grows this large. */
const MAX_CACHED_USERS = 2_000;

let globalCache: { at: number; caps: AiCaps } | null = null;
const userCache = new Map<string, { at: number; override: UserCapOverride }>();

/** Forget what this instance read, after the administration saved a change. */
export function clearAiCapsCache() {
  globalCache = null;
  userCache.clear();
}

/**
 * The caps in force: the 'ai_caps' row, or the defaults (JARVIS_MONTHLY_BUDGET_USD,
 * no per-user limit, 80 %) when there is none. When the row cannot be read the
 * defaults apply and the error goes to the server log; a failed read must not
 * switch the assistant off, nor lift the cap.
 */
export async function loadAiCaps(
  admin: Client,
  options: { now?: number; fresh?: boolean } = {},
): Promise<AiCaps> {
  const now = options.now ?? Date.now();
  if (!options.fresh && globalCache && now - globalCache.at <= CAPS_TTL_MS) return globalCache.caps;
  const { data, error } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "ai_caps")
    .maybeSingle();
  if (error) {
    console.error("ai caps read failed", error.message);
    return resolveAiCaps(null, process.env.JARVIS_MONTHLY_BUDGET_USD);
  }
  const caps = resolveAiCaps(data?.value ?? null, process.env.JARVIS_MONTHLY_BUDGET_USD);
  globalCache = { at: now, caps };
  return caps;
}

/** One user's exception, or null; a failed read counts as none (logged). */
export async function loadUserOverride(
  admin: Client,
  userId: string,
  options: { now?: number; fresh?: boolean } = {},
): Promise<UserCapOverride> {
  const now = options.now ?? Date.now();
  const cached = userCache.get(userId);
  if (!options.fresh && cached && now - cached.at <= CAPS_TTL_MS) return cached.override;
  const { data, error } = await admin
    .from("ai_user_caps")
    .select("cap_usd, blocked")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("ai user cap read failed", error.message);
    return null;
  }
  const override: UserCapOverride = data
    ? { capUsd: data.cap_usd === null ? null : Number(data.cap_usd), blocked: data.blocked }
    : null;
  if (userCache.size >= MAX_CACHED_USERS) userCache.clear();
  userCache.set(userId, { at: now, override });
  return override;
}

/** One user's AI spend since an instant (the start of the UTC month). */
export async function loadUserSpend(admin: Client, userId: string, since: Date): Promise<number> {
  const { data, error } = await admin.rpc("jarvis_user_month_spend", {
    _user_id: userId,
    _since: since.toISOString(),
  });
  if (error) throw error;
  return Number(data ?? 0);
}

/** The largest spend of one user since an instant, for the administration. */
export async function loadTopUserSpend(
  admin: Client,
  since: Date,
): Promise<{ userId: string; spentUsd: number } | null> {
  const { data, error } = await admin.rpc("jarvis_top_user_spend", {
    _since: since.toISOString(),
  });
  if (error) throw error;
  const row = data?.[0];
  return row ? { userId: row.user_id, spentUsd: Number(row.cost_usd ?? 0) } : null;
}
