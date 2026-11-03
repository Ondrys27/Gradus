/** What Company keeps in its address: the tab and the group filter. */

export const COMPANY_TABS = ["people", "groups", "rewards"] as const;
export type CompanyTab = (typeof COMPANY_TABS)[number];

export type CompanySearch = { tab: CompanyTab; group: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseCompanySearch(params: URLSearchParams): CompanySearch {
  const tab = params.get("tab");
  const group = params.get("group");
  return {
    tab: (COMPANY_TABS as readonly string[]).includes(tab ?? "") ? (tab as CompanyTab) : "people",
    group: group && UUID.test(group) ? group.toLowerCase() : null,
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
  return result.toString();
}
