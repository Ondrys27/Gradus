import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { METRICS_TIMEZONE } from "@/lib/analytics/metrics";
import type { AdminView } from "../view-state";
import { num } from "./metrics-data";

/**
 * The Users page: a searchable, sortable list and one account's detail, both
 * from the two dedicated functions of 20261009100000_admin_users.sql.
 * Identifiers and counts only; the page names people (and shows their
 * e-mail) through ./people (admin_people). The search matches the name, any
 * part of the e-mail and the start of the id, without diacritics; the short
 * id of step 22.4 joins it once it exists.
 */

export type UserSort = "activity" | "cost" | "signup";
export const USER_SORTS: readonly UserSort[] = ["activity", "cost", "signup"];
export const USERS_PAGE_SIZE = 50;

export type UserRow = {
  userId: string;
  plan: string;
  status: string;
  mode: string | null;
  industry: string | null;
  country: string | null;
  role: string | null;
  isInternal: boolean;
  signedUpAt: string;
  lastActiveAt: string | null;
  aiCostUsd: number;
};

/** The accounts of the view (internal accounts and segment), searched, sorted and paged. */
export async function loadUsers(input: {
  view: AdminView;
  query: string;
  sort: UserSort;
  page: number;
}): Promise<{ rows: UserRow[]; hasMore: boolean }> {
  const limit = USERS_PAGE_SIZE;
  const offset = Math.max(0, input.page) * limit;
  const { data, error } = await createAdminClient().rpc("metric_admin_users", {
    _tz: METRICS_TIMEZONE,
    _query: input.query || undefined,
    _sort: input.sort,
    _limit: limit + 1,
    _offset: offset,
    _include_internal: input.view.internal,
    _segment: { ...input.view.segment },
  });
  if (error) throw new Error(`metric_admin_users: ${error.message}`);
  const rows = (data ?? []).slice(0, limit).map(toUserRow);
  return { rows, hasMore: (data ?? []).length > limit };
}

type UserRpcRow = {
  user_id: string;
  plan: string | null;
  status: string | null;
  mode: string | null;
  industry: string | null;
  country: string | null;
  role: string | null;
  is_internal: boolean | null;
  signed_up_at: string;
  last_active_at: string | null;
  ai_cost_usd: number | string | null;
};

function toUserRow(row: UserRpcRow): UserRow {
  return {
    userId: row.user_id,
    plan: row.plan ?? "",
    status: row.status ?? "",
    mode: row.mode,
    industry: row.industry,
    country: row.country,
    role: row.role,
    isInternal: row.is_internal ?? false,
    signedUpAt: row.signed_up_at,
    lastActiveAt: row.last_active_at,
    aiCostUsd: num(row.ai_cost_usd) ?? 0,
  };
}

/** The most accounts one export carries. */
export const USERS_EXPORT_LIMIT = 5000;
const EXPORT_BATCH = 200;

/** Every account of the view and search for the CSV, in the list's order, at most USERS_EXPORT_LIMIT. */
export async function loadUsersForExport(input: {
  view: AdminView;
  query: string;
  sort: UserSort;
}): Promise<UserRow[]> {
  const all: UserRow[] = [];
  for (let page = 0; all.length < USERS_EXPORT_LIMIT; page++) {
    const { data, error } = await createAdminClient().rpc("metric_admin_users", {
      _tz: METRICS_TIMEZONE,
      _query: input.query || undefined,
      _sort: input.sort,
      _limit: EXPORT_BATCH,
      _offset: page * EXPORT_BATCH,
      _include_internal: input.view.internal,
      _segment: { ...input.view.segment },
    });
    if (error) throw new Error(`metric_admin_users: ${error.message}`);
    const rows = data ?? [];
    all.push(...rows.map(toUserRow));
    if (rows.length < EXPORT_BATCH) break;
  }
  return all.slice(0, USERS_EXPORT_LIMIT);
}

export type UserDetail = {
  plan: string;
  status: string;
  mode: string | null;
  industry: string | null;
  country: string | null;
  role: string | null;
  isInternal: boolean;
  signedUpAt: string;
  lastActiveAt: string | null;
  pathKey: string | null;
  seenLevel: number | null;
  activeDays30: number;
  sections: { section: string; actions: number }[];
  timeline: { event: string; at: string }[];
  ai: { calls: number; costUsd: number; inputTokens: number; outputTokens: number };
  workers: number;
  featureRequests: number;
  satisfaction: number | null;
};

export async function loadUserDetail(userId: string): Promise<UserDetail | null> {
  const { data, error } = await createAdminClient().rpc("metric_admin_user_detail", {
    _user_id: userId,
    _tz: METRICS_TIMEZONE,
  });
  if (error) throw new Error(`metric_admin_user_detail: ${error.message}`);
  if (!data) return null;
  const d = data as Record<string, unknown>;
  const ai = (d.ai ?? {}) as Record<string, unknown>;
  return {
    plan: String(d.plan ?? ""),
    status: String(d.status ?? ""),
    mode: (d.mode as string) ?? null,
    industry: (d.industry as string) ?? null,
    country: (d.country as string) ?? null,
    role: (d.role as string) ?? null,
    isInternal: Boolean(d.is_internal),
    signedUpAt: String(d.signed_up_at),
    lastActiveAt: (d.last_active_at as string) ?? null,
    pathKey: (d.path_key as string) ?? null,
    seenLevel: num(d.seen_level),
    activeDays30: num(d.active_days_30) ?? 0,
    sections: ((d.sections as { section: string; actions: number }[] | null) ?? []).map((row) => ({
      section: row.section,
      actions: num(row.actions) ?? 0,
    })),
    timeline: ((d.timeline as { event: string; at: string }[] | null) ?? []),
    ai: {
      calls: num(ai.calls) ?? 0,
      costUsd: num(ai.cost_usd) ?? 0,
      inputTokens: num(ai.input_tokens) ?? 0,
      outputTokens: num(ai.output_tokens) ?? 0,
    },
    workers: num(d.workers) ?? 0,
    featureRequests: num(d.feature_requests) ?? 0,
    satisfaction: num(d.satisfaction),
  };
}

/** Flips profiles.is_internal; admin_audit records it as 'update'. */
export async function setUserInternal(userId: string, internal: boolean): Promise<void> {
  const { error } = await createAdminClient()
    .from("profiles")
    .update({ is_internal: internal })
    .eq("id", userId);
  if (error) throw new Error(`profiles.is_internal: ${error.message}`);
}
