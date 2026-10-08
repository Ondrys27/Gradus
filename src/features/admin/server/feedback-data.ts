import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { breakdown, distribution, type AdminQuery } from "./metrics-data";
import { npsScore } from "../numbers";
import type { BreakdownData, FeatureRequestRow, FeatureRequestStatus } from "../types";

/**
 * The Feedback page's own data: ideas and NPS comments, read directly (they
 * are explicit, intended-for-the-owner feedback, not analytics content) next
 * to the registry's nps and jarvis_answer_ratings breakdowns.
 *
 * FeatureRequestStatus, FEATURE_REQUEST_STATUSES and FeatureRequestRow live in
 * ../types (not here): the status row is also rendered by a client component,
 * which must not pull this server-only module into its bundle.
 */

export async function loadFeatureRequests(
  status: FeatureRequestStatus | null,
): Promise<FeatureRequestRow[]> {
  let query = createAdminClient()
    .from("feature_requests")
    .select("id, user_id, title, description, status, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new Error(`feature_requests: ${error.message}`);
  return data.map((row) => ({
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
  }));
}

export type NpsComment = { userId: string; score: number; comment: string; createdAt: string };

/** The most recent answers that left a comment; the score alone is in the breakdown. */
export async function loadNpsComments(limit = 50): Promise<NpsComment[]> {
  const { data, error } = await createAdminClient()
    .from("nps_responses")
    .select("user_id, score, comment, created_at")
    .not("comment", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`nps_responses: ${error.message}`);
  return data
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
