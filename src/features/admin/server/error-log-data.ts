import "server-only";
import { APP_VERSION } from "@/lib/app-version";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ERROR_LOG_PAGE_SIZE,
  ERROR_OCCURRENCES,
  isErrorGroupStatus,
  stackHead,
  type ErrorGroupStatus,
  type ErrorLogFilters,
} from "../error-log";
import type { AdminQuery } from "./metrics-data";
import { peopleNamer } from "./people";

/**
 * Operations → Errors (step 27.2): the caught errors grouped by fingerprint
 * and one group's detail. Technical data only (the scrubbed message, the
 * page without ids, the first stack lines, the browser class); read through
 * the admin client after the admin guard.
 */

export type ErrorGroupRow = {
  fingerprint: string;
  status: ErrorGroupStatus;
  returnedAt: string | null;
  lastCode: string;
  message: string;
  page: string;
  action: string | null;
  source: string;
  occurrences: number;
  users: number;
  firstAt: string;
  lastAt: string;
  lastVersion: string | null;
};

export async function loadErrorGroups(
  q: AdminQuery,
  filters: Pick<ErrorLogFilters, "status" | "code" | "latest" | "page">,
): Promise<{ rows: ErrorGroupRow[]; total: number; version: string }> {
  const { data, error } = await createAdminClient().rpc("admin_error_groups", {
    _from: q.range.from,
    _to: q.range.to,
    _status: filters.status ?? undefined,
    _code: filters.code ?? undefined,
    _version: filters.latest ? APP_VERSION : undefined,
    _limit: ERROR_LOG_PAGE_SIZE,
    _offset: filters.page * ERROR_LOG_PAGE_SIZE,
  });
  if (error) throw new Error(`admin_error_groups: ${error.message}`);
  const rows = (data ?? []).map((row) => ({
    fingerprint: row.fingerprint,
    status: isErrorGroupStatus(row.status) ? row.status : "new",
    returnedAt: row.returned_at ?? null,
    lastCode: row.last_code,
    message: row.message,
    page: row.page,
    action: row.action ?? null,
    source: row.source,
    occurrences: row.occurrences ?? 0,
    users: row.users ?? 0,
    firstAt: row.first_at,
    lastAt: row.last_at,
    lastVersion: row.last_version ?? null,
  }));
  return { rows, total: data?.[0]?.total ?? 0, version: APP_VERSION };
}

export type ErrorOccurrence = {
  code: string;
  createdAt: string;
  source: string;
  page: string;
  action: string | null;
  userId: string | null;
  userName: string | null;
  browser: string | null;
  device: string | null;
  viewport: string | null;
  version: string | null;
  stack: string | null;
};

export type ErrorSend = {
  kind: string;
  status: string;
  createdAt: string;
  sentAt: string | null;
  recipients: number;
  /** Who it went to (the alert settings' addresses); null for e-mails sent before step 27.2. */
  to: string[] | null;
  mock: boolean;
};

export type ErrorReport = {
  id: string;
  code: string;
  status: string;
  kind: string;
  createdAt: string;
};

export type ErrorGroupDetail = {
  fingerprint: string;
  status: ErrorGroupStatus;
  returnedAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  /** What was found and done (the triage of 30.1: the cause, the commit). */
  note: string | null;
  message: string;
  occurrences: ErrorOccurrence[];
  sends: ErrorSend[];
  reports: ErrorReport[];
};

/** One group: its newest occurrences, the e-mails sent about it and the bug reports with one of its codes. */
export async function loadErrorGroup(fingerprint: string): Promise<ErrorGroupDetail | null> {
  const admin = createAdminClient();
  const [events, state, sends, reports] = await Promise.all([
    admin
      .from("error_events")
      .select("code, created_at, source, page, action, message, user_id, browser, device, viewport, app_version, stack")
      .eq("fingerprint", fingerprint)
      .order("created_at", { ascending: false })
      .limit(ERROR_OCCURRENCES),
    admin
      .from("error_groups")
      .select("status, returned_at, updated_at, updated_by, note")
      .eq("fingerprint", fingerprint)
      .maybeSingle(),
    admin
      .from("error_alert_sends")
      .select("kind, status, created_at, sent_at, recipients, to_emails, transport")
      .eq("fingerprint", fingerprint)
      .order("created_at", { ascending: false })
      .limit(20),
    admin.rpc("admin_error_group_reports", { _fingerprint: fingerprint }),
  ]);
  if (events.error) throw new Error(`error_events: ${events.error.message}`);
  if (state.error) throw new Error(`error_groups: ${state.error.message}`);
  if (sends.error) throw new Error(`error_alert_sends: ${sends.error.message}`);
  if (reports.error) throw new Error(`admin_error_group_reports: ${reports.error.message}`);
  const rows = events.data ?? [];
  if (!rows.length) return null;
  const nameOf = await peopleNamer([...rows.map((row) => row.user_id), state.data?.updated_by]);
  return {
    fingerprint,
    status: isErrorGroupStatus(state.data?.status) ? state.data.status : "new",
    returnedAt: state.data?.returned_at ?? null,
    updatedAt: state.data?.updated_at ?? null,
    updatedBy: state.data?.updated_by ? nameOf(state.data.updated_by) : null,
    note: state.data?.note ?? null,
    message: rows[0]!.message,
    occurrences: rows.map((row) => ({
      code: row.code,
      createdAt: row.created_at,
      source: row.source,
      page: row.page,
      action: row.action,
      userId: row.user_id,
      userName: row.user_id ? nameOf(row.user_id) : null,
      browser: row.browser,
      device: row.device,
      viewport: row.viewport,
      version: row.app_version,
      stack: stackHead(row.stack),
    })),
    sends: (sends.data ?? []).map((row) => ({
      kind: row.kind,
      status: row.status,
      createdAt: row.created_at,
      sentAt: row.sent_at,
      recipients: row.recipients,
      to: row.to_emails ?? null,
      mock: row.transport === "mock",
    })),
    reports: (reports.data ?? []).map((row) => ({
      id: row.id,
      code: row.error_code,
      status: row.status,
      kind: row.kind,
      createdAt: row.created_at,
    })),
  };
}
