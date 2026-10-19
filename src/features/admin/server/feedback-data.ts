import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { METRICS_TIMEZONE } from "@/lib/analytics/metrics";
import { metricParams } from "../view-state";
import { breakdown, distribution, type AdminQuery } from "./metrics-data";
import { npsScore } from "../numbers";
import { peopleNamer } from "./people";
import type { BreakdownData, FeatureRequestRow, FeatureRequestStatus } from "../types";

/**
 * The Feedback page's own data: ideas and NPS comments (explicit feedback
 * meant for the owner, not analytics content), through admin_feature_requests
 * and admin_nps_comments with the same internal accounts and segment as the
 * registry's nps and jarvis_answer_ratings breakdowns next to them.
 *
 * FeatureRequestStatus, FEATURE_REQUEST_STATUSES and FeatureRequestRow live in
 * ../types (not here): the status row is also rendered by a client component,
 * which must not pull this server-only module into its bundle.
 */

/** The accounts in the view, as every list of this page filters them. */
function viewArgs(q: AdminQuery) {
  const params = metricParams(q.view, q.range);
  return {
    _tz: METRICS_TIMEZONE,
    _include_internal: params.includeInternal ?? false,
    _segment: params.segment ?? {},
  };
}

/** The backlog now (like its status counts), of the accounts in the view. */
export async function loadFeatureRequests(
  q: AdminQuery,
  status: FeatureRequestStatus | null,
): Promise<FeatureRequestRow[]> {
  const { data, error } = await createAdminClient().rpc("admin_feature_requests", {
    ...viewArgs(q),
    _status: status ?? undefined,
    _limit: 200,
  });
  if (error) throw new Error(`admin_feature_requests: ${error.message}`);
  const rows = data ?? [];
  const nameOf = await peopleNamer(rows.map((row) => row.user_id));
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userName: nameOf(row.user_id),
    title: row.title,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
  }));
}

export type NpsComment = { userId: string; score: number; comment: string; createdAt: string };

/** The answers in the period that left a comment; the score alone is in the breakdown. */
export async function loadNpsComments(q: AdminQuery, limit = 50): Promise<NpsComment[]> {
  const { data, error } = await createAdminClient().rpc("admin_nps_comments", {
    ...viewArgs(q),
    _from: q.range.from,
    _to: q.range.to,
    _limit: limit,
  });
  if (error) throw new Error(`admin_nps_comments: ${error.message}`);
  return (data ?? [])
    .filter((row): row is typeof row & { comment: string } => Boolean(row.comment))
    .map((row) => ({
      userId: row.user_id,
      score: row.score,
      comment: row.comment,
      createdAt: row.created_at,
    }));
}

export type NpsSummary = { score: number | null; responses: number; distribution: BreakdownData };

export async function loadNpsSummary(q: AdminQuery): Promise<NpsSummary> {
  const distribution = await breakdown(q, "nps");
  const responses = distribution.items.reduce((sum, item) => sum + (item.value ?? 0), 0);
  return { score: npsScore(distribution.items), responses, distribution };
}

export async function jarvisAnswerRatings(q: AdminQuery): Promise<BreakdownData> {
  return breakdown(q, "jarvis_answer_ratings");
}

export async function featureRequestCounts(q: AdminQuery): Promise<BreakdownData> {
  return distribution(q, "feature_requests");
}
