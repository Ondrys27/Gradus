import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { METRICS_TIMEZONE } from "@/lib/analytics/metrics";
import { metricParams } from "../view-state";
import { breakdown, distribution, type AdminQuery } from "./metrics-data";
import { satisfactionAverage } from "../numbers";
import { peopleNamer } from "./people";
import {
  BUG_REPORT_KINDS,
  BUG_REPORT_STATUSES,
  type BreakdownData,
  type BugReportConsoleLine,
  type BugReportKind,
  type BugReportRow,
  type BugReportSource,
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

function isKind(value: string): value is BugReportKind {
  return (BUG_REPORT_KINDS as readonly string[]).includes(value);
}

function consoleLines(value: unknown): BugReportConsoleLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { at, kind, message } = item as Record<string, unknown>;
    return typeof message === "string"
      ? [
          {
            at: typeof at === "string" ? at : "",
            kind: typeof kind === "string" ? kind : "",
            message,
          },
        ]
      : [];
  });
}

export type BugReportFilters = {
  status: BugReportStatus | null;
  kind: BugReportKind | null;
  source: BugReportSource | null;
};

type ListArgs = BugReportFilters & { code?: string | null; id?: string | null; limit?: number };

/** What the list adds to each row: whether the sender is internal, and a support request's e-mail. */
async function reportExtras(rows: { id: string; user_id: string | null }[]) {
  const admin = createAdminClient();
  const users = [...new Set(rows.flatMap((row) => (row.user_id ? [row.user_id] : [])))];
  const [profiles, contacts] = await Promise.all([
    users.length
      ? admin.from("profiles").select("id, is_internal").in("id", users)
      : Promise.resolve({ data: [], error: null }),
    rows.length
      ? admin.from("bug_reports").select("id, contact_email").in("id", rows.map((row) => row.id))
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (profiles.error) throw new Error(`profiles: ${profiles.error.message}`);
  if (contacts.error) throw new Error(`bug_reports: ${contacts.error.message}`);
  const internal = new Set((profiles.data ?? []).filter((row) => row.is_internal).map((row) => row.id));
  const contact = new Map((contacts.data ?? []).map((row) => [row.id, row.contact_email]));
  return { internal, contact };
}

function sourceOf(value: string): BugReportSource {
  return value === "report" || value === "support" ? value : "error_page";
}

/**
 * Reports and errors belong to no metric: every report is listed, internal
 * accounts' too (labelled "internal"), whatever the view's internal switch
 * says, so the owner and every admin see the same list (27.1).
 */
async function listBugReports(_q: AdminQuery, args: ListArgs): Promise<BugReportRow[]> {
  const { data, error } = await createAdminClient().rpc("admin_bug_report_list", {
    _code: args.code ?? undefined,
    _id: args.id ?? undefined,
    _status: args.status ?? undefined,
    _kind: args.kind ?? undefined,
    _source: args.source ?? undefined,
    _include_internal: true,
    _limit: args.limit ?? 100,
  });
  if (error) throw new Error(`admin_bug_report_list: ${error.message}`);
  const rows = data ?? [];
  const [nameOf, extras] = await Promise.all([
    peopleNamer(rows.map((row) => row.user_id)),
    reportExtras(rows),
  ]);
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userName: row.user_id ? nameOf(row.user_id) : null,
    internal: Boolean(row.user_id && extras.internal.has(row.user_id)),
    contactEmail: extras.contact.get(row.id) ?? null,
    kind: isKind(row.kind) ? row.kind : "bug",
    source: sourceOf(row.source),
    status: isBugReportStatus(row.status) ? row.status : "new",
    code: row.error_code,
    description: row.description,
    expected: row.expected,
    message: row.error_message,
    digest: row.error_digest,
    page: row.page,
    browser: row.browser,
    device: row.device,
    viewport: row.viewport,
    locale: row.locale,
    version: row.app_version,
    consoleErrors: consoleLines(row.console_errors),
    screenshotPath: row.screenshot_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * The newest bug reports with the filters, or the ones whose code begins with
 * `code` (already normalized, GR-…). Searching by code finds internal
 * accounts' reports too; the list itself follows the view's internal accounts switch.
 */
export async function loadBugReports(
  q: AdminQuery,
  code: string | null,
  filters: BugReportFilters = { status: null, kind: null, source: null },
): Promise<BugReportRow[]> {
  return listBugReports(q, { ...filters, code, limit: 100 });
}

/** One report by id, whoever sent it; null when there is none. */
export async function loadBugReport(q: AdminQuery, id: string): Promise<BugReportRow | null> {
  const rows = await listBugReports(q, { status: null, kind: null, source: null, id, limit: 1 });
  return rows[0] ?? null;
}

/** How many reports wait for a first look (status new), internal accounts' included. */
export async function countNewBugReports(q: AdminQuery): Promise<number> {
  void q;
  const { count, error } = await createAdminClient()
    .from("bug_reports")
    .select("id", { count: "exact", head: true })
    .eq("status", "new");
  if (error) throw new Error(`bug_reports: ${error.message}`);
  return count ?? 0;
}

/** Reports that came in after `since` (the newest one on screen): the list offers to refresh. */
export async function countBugReportsSince(since: string): Promise<number> {
  const { count, error } = await createAdminClient()
    .from("bug_reports")
    .select("id", { count: "exact", head: true })
    .gt("created_at", since);
  if (error) throw new Error(`bug_reports: ${error.message}`);
  return count ?? 0;
}

/** A link to a report's screenshot that works for two minutes; the bucket is private. */
export async function reportScreenshotUrl(path: string): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .storage.from("bug-screenshots")
    .createSignedUrl(path, 120);
  return error ? null : data.signedUrl;
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

export async function gradyAnswerRatings(q: AdminQuery): Promise<BreakdownData> {
  return breakdown(q, "jarvis_answer_ratings");
}

export async function featureRequestCounts(q: AdminQuery): Promise<BreakdownData> {
  return distribution(q, "feature_requests");
}
