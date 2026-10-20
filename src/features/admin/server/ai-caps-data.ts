import "server-only";
import { cache } from "react";
import { METRICS_TIMEZONE, shiftDay } from "@/lib/analytics/metrics";
import { zonedWallClockToInstant, type IsoDate } from "@/lib/format";
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

export type PeriodSpend = {
  spentUsd: number;
  calls: number;
  /** The costliest single user in the period, or null when nobody used AI. */
  topUserSpentUsd: number | null;
};

/**
 * AI spend of all accounts (internal ones too) over whole days of the metrics
 * time zone, for the budget card and the cap meters of a period other than
 * the calendar month. Cached per request: both blocks of the page share it.
 */
export const loadPeriodSpend = cache(async (from: IsoDate, to: IsoDate): Promise<PeriodSpend> => {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("jarvis_range_spend", {
    _since: zonedWallClockToInstant(from, "00:00", METRICS_TIMEZONE).toISOString(),
    _until: zonedWallClockToInstant(shiftDay(to, 1), "00:00", METRICS_TIMEZONE).toISOString(),
  });
  if (error) throw error;
  const row = data?.[0];
  return {
    spentUsd: Number(row?.cost_usd ?? 0),
    calls: Number(row?.calls ?? 0),
    topUserSpentUsd: row?.top_user_cost_usd == null ? null : Number(row.top_user_cost_usd),
  };
});
