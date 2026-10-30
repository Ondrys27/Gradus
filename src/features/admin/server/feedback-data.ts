import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { METRICS_TIMEZONE } from "@/lib/analytics/metrics";
import { metricParams } from "../view-state";
import { breakdown, distribution, type AdminQuery } from "./metrics-data";
import { satisfactionAverage } from "../numbers";
import { peopleNamer } from "./people";
import {
  BUG_REPORT_STATUSES,
  type BreakdownData,
  type BugReportRow,
  type BugReportStatus,
  type FeatureRequestRow,
  type FeatureRequestStatus,
} from "../types";

/**
 * The Feedback page's own data: ideas and satisfaction answers (explicit
 * feedback meant for the owner, not analytics content), through
 * admin_feature_requests and admin_satisfaction_responses with the same
 * internal accounts and segment as the registry's satisfaction and
 * jarvis_answer_ratings breakdowns next to them.
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

function isBugReportStatus(value: string): value is BugReportStatus {
  return (BUG_REPORT_STATUSES as readonly string[]).includes(value);
}

/**
 * The newest bug reports, or the ones whose code begins with `code` (already
 * normalized, GR-…). Searching by code finds internal accounts' reports too;
 * the list itself follows the view's internal accounts switch.
 */
export async function loadBugReports(q: AdminQuery, code: string | null): Promise<BugReportRow[]> {
  const { data, error } = await createAdminClient().rpc("admin_bug_reports", {
    _code: code ?? undefined,
    _include_internal: viewArgs(q)._include_internal,
    _limit: 50,
  });
  if (error) throw new Error(`admin_bug_reports: ${error.message}`);
  const rows = data ?? [];
  const nameOf = await peopleNamer(rows.map((row) => row.user_id));
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userName: row.user_id ? nameOf(row.user_id) : null,
    status: isBugReportStatus(row.status) ? row.status : "new",
    code: row.error_code,
    description: row.description,
    message: row.error_message,
    digest: row.error_digest,
    page: row.page,
    browser: row.browser,
    device: row.device,
    viewport: row.viewport,
    version: row.app_version,
    createdAt: row.created_at,
  }));
}

export type SatisfactionAnswer = {
  userId: string;
  userName: string;
  satisfaction: number;
  liked: string | null;
  improve: string | null;
  createdAt: string;
};

/** The answers in the period that said something in words; the scores alone are in the breakdown. */
export async function loadSatisfactionAnswers(
  q: AdminQuery,
  limit = 50,
): Promise<SatisfactionAnswer[]> {
  const { data, error } = await createAdminClient().rpc("admin_satisfaction_responses", {
    ...viewArgs(q),
    _from: q.range.from,
    _to: q.range.to,
    _limit: limit,
  });
  if (error) throw new Error(`admin_satisfaction_responses: ${error.message}`);
  const rows = data ?? [];
  const nameOf = await peopleNamer(rows.map((row) => row.user_id));
  return rows.map((row) => ({
    userId: row.user_id,
    userName: nameOf(row.user_id),
    satisfaction: row.satisfaction,
    liked: row.liked,
    improve: row.improve,
    createdAt: row.created_at,
  }));
}

export type SatisfactionSummary = {
  average: number | null;
  responses: number;
  distribution: BreakdownData;
};

export async function loadSatisfactionSummary(q: AdminQuery): Promise<SatisfactionSummary> {
  const distribution = await breakdown(q, "satisfaction");
  const responses = distribution.items.reduce((sum, item) => sum + (item.value ?? 0), 0);
  return { average: satisfactionAverage(distribution.items), responses, distribution };
}

export async function jarvisAnswerRatings(q: AdminQuery): Promise<BreakdownData> {
  return breakdown(q, "jarvis_answer_ratings");
}

export async function featureRequestCounts(q: AdminQuery): Promise<BreakdownData> {
  return distribution(q, "feature_requests");
}
