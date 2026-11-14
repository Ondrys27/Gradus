import { normalizeErrorCodeQuery } from "@/features/errors/error-code";

/**
 * The error log of the administration (step 27.2): every caught error
 * (error_events) grouped by its fingerprint, each group with a state. Pure
 * rules here; the data in server/error-log-data.ts.
 */

export const ERROR_GROUP_STATUSES = ["new", "in_progress", "resolved", "ignored"] as const;
export type ErrorGroupStatus = (typeof ERROR_GROUP_STATUSES)[number];

export const ERROR_LOG_TABS = ["log", "alerts"] as const;
export type ErrorLogTab = (typeof ERROR_LOG_TABS)[number];

export const ERROR_LOG_PAGE_SIZE = 50;
/** The occurrences one group's detail lists. */
export const ERROR_OCCURRENCES = 50;

const FINGERPRINT = /^[0-9a-f]{16,64}$/;

export function isErrorGroupStatus(value: unknown): value is ErrorGroupStatus {
  return typeof value === "string" && (ERROR_GROUP_STATUSES as readonly string[]).includes(value);
}

export function isFingerprint(value: unknown): value is string {
  return typeof value === "string" && FINGERPRINT.test(value);
}

export type ErrorLogFilters = {
  tab: ErrorLogTab;
  status: ErrorGroupStatus | null;
  /** The code searched for (GR-…, possibly its beginning), normalized; null without a search. */
  code: string | null;
  /** What was typed into the search, to show it back. */
  rawCode: string;
  /** Only the occurrences of the version running now. */
  latest: boolean;
  /** The open group (its fingerprint). */
  group: string | null;
  page: number;
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The log's own part of the address; the shared view (period) is read by the page as everywhere. */
export function parseErrorLogFilters(params: Record<string, string | string[] | undefined>): ErrorLogFilters {
  const rawCode = (first(params.code) ?? "").slice(0, 20);
  const status = first(params.status);
  const group = first(params.group);
  const page = Number.parseInt(first(params.page) ?? "0", 10);
  return {
    tab: first(params.tab) === "alerts" ? "alerts" : "log",
    status: isErrorGroupStatus(status) ? status : null,
    code: normalizeErrorCodeQuery(rawCode),
    rawCode,
    latest: first(params.latest) === "1",
    group: isFingerprint(group) ? group : null,
    page: Number.isFinite(page) ? Math.min(1000, Math.max(0, page)) : 0,
  };
}

/** The address of the log with these filters (and the shared view, `kept` without "?"). */
export function errorLogSearch(
  filters: Partial<Omit<ErrorLogFilters, "code">> & { rawCode?: string },
  kept = "",
): string {
  const parts = new URLSearchParams();
  if (filters.tab === "alerts") parts.set("tab", "alerts");
  if (filters.status) parts.set("status", filters.status);
  if (filters.rawCode) parts.set("code", filters.rawCode);
  if (filters.latest) parts.set("latest", "1");
  if (filters.group) parts.set("group", filters.group);
  if (filters.page) parts.set("page", String(filters.page));
  for (const [key, value] of new URLSearchParams(kept.replace(/^\?/, ""))) {
    if (!parts.has(key)) parts.set(key, value);
  }
  const query = parts.toString();
  return query ? `?${query}` : "";
}

/**
 * "Came back": a resolved error happened again and is new (or being looked
 * at) since. Once resolved again, the label goes; the next return brings it back.
 */
export function cameBack(status: ErrorGroupStatus, returnedAt: string | null): boolean {
  return returnedAt !== null && (status === "new" || status === "in_progress");
}

/**
 * What a status change writes on the group row besides the status. Resolved
 * or ignored closes the story of a return, so the label "came back" goes
 * with it; New or Being fixed keep it (a returned error being looked at is
 * still one that came back).
 */
export function statusChange(
  status: ErrorGroupStatus,
  now: string,
): { status: ErrorGroupStatus; resolved_at: string | null; returned_at?: null } {
  const closed = status === "resolved" || status === "ignored";
  return { status, resolved_at: status === "resolved" ? now : null, ...(closed ? { returned_at: null } : {}) };
}

/** The first lines of a stack, the most the log shows of one occurrence. */
export function stackHead(stack: string | null, lines = 10): string | null {
  if (!stack) return null;
  const head = stack.split("\n").filter((line) => line.trim()).slice(0, lines);
  return head.length ? head.join("\n") : null;
}
