import { ADMIN_PATH } from "./access";
import { ADMIN_SECTIONS, isActiveSection, type AdminSectionKey } from "./nav";
import {
  ADMIN_SEGMENT_KEYS,
  DEFAULT_VIEW,
  type AdminSegmentKey,
  type AdminView,
} from "./view-state";

/**
 * Which of the shared filters each page of the administration offers. A page
 * offers a filter only when every list and number on it applies it (the
 * exceptions are named in filters.test.ts with the reason): what a page does
 * not offer is neither shown there nor passed to its queries, so a filter
 * never half-applies. The rest of the view stays in the address for the
 * other pages.
 */

export type AdminFilter = "period" | "compare" | "internal" | AdminSegmentKey;

/** The segments that describe an account (the device describes a visit). */
const ACCOUNT_SEGMENTS = ["plan", "mode", "industry", "locale", "country", "role"] as const;

const METRIC_PAGE: readonly AdminFilter[] = ["period", "compare", "internal", ...ACCOUNT_SEGMENTS];

export const PAGE_FILTERS: Record<AdminSectionKey, readonly AdminFilter[]> = {
  overview: METRIC_PAGE,
  growth: METRIC_PAGE,
  activation: METRIC_PAGE,
  retention: METRIC_PAGE,
  features: METRIC_PAGE,
  ai: METRIC_PAGE,
  game: METRIC_PAGE,
  costs: METRIC_PAGE,
  // Errors, server calls and scheduled jobs belong to no account.
  health: ["period", "compare"],
  feedback: METRIC_PAGE,
  // One event per visit: the device applies; the chart has no previous period.
  explorer: ["period", "internal", ...ACCOUNT_SEGMENTS, "device"],
  // The accounts as they are now: no period.
  users: ["internal", ...ACCOUNT_SEGMENTS],
  audit: [],
  admins: [],
};

/** The section a path belongs to; one user's detail is a page of its own without filters. */
export function sectionOf(pathname: string): AdminSectionKey | null {
  const detail = new RegExp(`^${ADMIN_PATH}/uzivatele/[^/]+/?$`);
  if (detail.test(pathname)) return null;
  // The overview matches only itself; every other section also its sub-pages.
  const section = ADMIN_SECTIONS.find((candidate) => isActiveSection(candidate.href, pathname));
  return section?.key ?? null;
}

export function filtersFor(pathname: string): readonly AdminFilter[] {
  const section = sectionOf(pathname);
  return section ? PAGE_FILTERS[section] : [];
}

export function offersFilter(filters: readonly AdminFilter[], filter: AdminFilter): boolean {
  return filters.includes(filter);
}

/**
 * The view a page computes with: every filter it does not offer back at its
 * neutral value (no comparison, no internal accounts, no segment, the default
 * period).
 */
export function scopeView(view: AdminView, filters: readonly AdminFilter[]): AdminView {
  const segment: AdminView["segment"] = {};
  for (const key of ADMIN_SEGMENT_KEYS) {
    const value = view.segment[key];
    if (value && filters.includes(key)) segment[key] = value;
  }
  const period = filters.includes("period");
  return {
    period: period ? view.period : DEFAULT_VIEW.period,
    from: period ? view.from : null,
    to: period ? view.to : null,
    compare: filters.includes("compare") ? view.compare : false,
    internal: filters.includes("internal") ? view.internal : false,
    segment,
  };
}

/** One active filter as the page shows it: a label with a cross. */
export type ActiveFilter =
  | { kind: "period" }
  | { kind: "compare" }
  | { kind: "internal" }
  | { kind: "segment"; key: AdminSegmentKey; value: string };

/** The filters of this page that differ from the default, in the order of the controls. */
export function activeFilters(view: AdminView, filters: readonly AdminFilter[]): ActiveFilter[] {
  const active: ActiveFilter[] = [];
  if (filters.includes("period") && view.period !== DEFAULT_VIEW.period) active.push({ kind: "period" });
  if (filters.includes("compare") && view.compare !== DEFAULT_VIEW.compare) active.push({ kind: "compare" });
  if (filters.includes("internal") && view.internal !== DEFAULT_VIEW.internal) active.push({ kind: "internal" });
  for (const key of ADMIN_SEGMENT_KEYS) {
    const value = view.segment[key];
    if (value && filters.includes(key)) active.push({ kind: "segment", key, value });
  }
  return active;
}

/** The view without one active filter. */
export function withoutFilter(view: AdminView, filter: ActiveFilter): AdminView {
  switch (filter.kind) {
    case "period":
      return { ...view, period: DEFAULT_VIEW.period, from: null, to: null };
    case "compare":
      return { ...view, compare: DEFAULT_VIEW.compare };
    case "internal":
      return { ...view, internal: DEFAULT_VIEW.internal };
    case "segment": {
      const segment = { ...view.segment };
      delete segment[filter.key];
      return { ...view, segment };
    }
  }
}

/** The view without any filter this page offers; filters of other pages stay. */
export function withoutFilters(view: AdminView, filters: readonly AdminFilter[]): AdminView {
  return activeFilters(view, filters).reduce(withoutFilter, view);
}
