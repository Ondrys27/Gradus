import type { WorkerStatus } from "../types";
import { isDashboardTab, type DashboardTab } from "../dashboard/types";

/**
 * What Company keeps in its address: the tab, the group and status filters,
 * and the person whose dashboard is open (`worker`, with its tab `wtab`).
 */

export const COMPANY_TABS = ["people", "groups", "rewards"] as const;
export type CompanyTab = (typeof COMPANY_TABS)[number];

/** "current" (active and invited) is the default; ended people show through the filter. */
export const STATUS_FILTERS = ["current", "all", "active", "invited", "ended"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export type CompanySearch = {
  tab: CompanyTab;
  group: string | null;
  status: StatusFilter;
  worker: string | null;
  workerTab: DashboardTab;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseCompanySearch(params: URLSearchParams): CompanySearch {
  const tab = params.get("tab");
  const group = params.get("group");
  const status = params.get("status");
  const worker = params.get("worker");
  const workerTab = params.get("wtab");
  return {
    tab: (COMPANY_TABS as readonly string[]).includes(tab ?? "") ? (tab as CompanyTab) : "people",
    group: group && UUID.test(group) ? group.toLowerCase() : null,
    status: (STATUS_FILTERS as readonly string[]).includes(status ?? "")
      ? (status as StatusFilter)
      : "current",
    worker: worker && UUID.test(worker) ? worker.toLowerCase() : null,
    workerTab: isDashboardTab(workerTab) ? workerTab : "overview",
  };
}

/** The address of a state, keeping other parameters; the defaults leave no trace. */
export function companySearchString(params: URLSearchParams, next: Partial<CompanySearch>): string {
  const result = new URLSearchParams(params);
  if (next.tab !== undefined) {
    if (next.tab === "people") result.delete("tab");
    else result.set("tab", next.tab);
  }
  if (next.group !== undefined) {
    if (next.group) result.set("group", next.group);
    else result.delete("group");
  }
  if (next.status !== undefined) {
    if (next.status === "current") result.delete("status");
    else result.set("status", next.status);
  }
  if (next.worker !== undefined) {
    if (next.worker) result.set("worker", next.worker);
    else {
      result.delete("worker");
      result.delete("wtab");
    }
  }
  if (next.workerTab !== undefined && (next.worker ?? result.get("worker"))) {
    if (next.workerTab === "overview") result.delete("wtab");
    else result.set("wtab", next.workerTab);
  }
  return result.toString();
}

/** Whether a person shows under the status filter. */
export function matchesStatus(status: WorkerStatus, filter: StatusFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "current":
      return status !== "inactive";
    case "ended":
      return status === "inactive";
    default:
      return status === filter;
  }
}
