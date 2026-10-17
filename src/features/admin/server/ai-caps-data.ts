import "server-only";
import { utcMonthStart } from "@/features/jarvis/budget";
import { userLimit, type AiCaps, type UserCapOverride, type UserLimit } from "@/features/jarvis/caps";
import {
  loadAiCaps,
  loadTopUserSpend,
  loadUserOverride,
  loadUserSpend,
} from "@/features/jarvis/server/caps";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * What the administration shows next to the cap forms: the caps in force
 * (read fresh, not from the instance's cache) and this month's spend. Read
 * only after the guard let the owner in.
 */

export type AiCapsOverview = {
  caps: AiCaps;
  spentUsd: number;
  /** The costliest single user this month, or null when nobody used AI yet. */
  topUserSpentUsd: number | null;
};

export async function loadAiCapsOverview(now: Date = new Date()): Promise<AiCapsOverview> {
  const admin = createAdminClient();
  const since = utcMonthStart(now);
  const [caps, spend, top] = await Promise.all([
    loadAiCaps(admin, { fresh: true }),
    admin.rpc("jarvis_month_spend", { _since: since.toISOString() }),
    loadTopUserSpend(admin, since),
  ]);
  if (spend.error) throw spend.error;
  return {
    caps,
    spentUsd: Number(spend.data?.[0]?.cost_usd ?? 0),
    topUserSpentUsd: top?.spentUsd ?? null,
  };
}

export type UserAiCapView = {
  override: UserCapOverride;
  limit: UserLimit;
  spentUsd: number;
};

export async function loadUserAiCap(userId: string, now: Date = new Date()): Promise<UserAiCapView> {
  const admin = createAdminClient();
  const [caps, override, spentUsd] = await Promise.all([
    loadAiCaps(admin, { fresh: true }),
    loadUserOverride(admin, userId, { fresh: true }),
    loadUserSpend(admin, userId, utcMonthStart(now)),
  ]);
  return { override, limit: userLimit(caps, override), spentUsd };
}
