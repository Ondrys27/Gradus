import type { LayoutItem } from "./grid";

/**
 * Which layout the main tab shows (28.5). Untouched, it follows the default
 * live: the owner's for this person (a person's > a group's > the company's)
 * or the system's by role, mode and industry. Changed, it is the person's own;
 * a company default saved after their change is only offered, never forced.
 */
export type MainResolution = {
  items: LayoutItem[];
  /** Follows the default; the first change makes it the person's own. */
  follows: boolean;
  /** Where the default comes from: the owner's company default or the system's. */
  defaultFrom: "company" | "system";
  /** The company saved a newer default than the one the own layout was made from. */
  offer: boolean;
};

export function resolveMain(input: {
  own: { items: LayoutItem[] | null; basedOn: string | null } | null;
  company: { items: LayoutItem[] | null; updatedAt: string | null } | null;
  system: LayoutItem[];
}): MainResolution {
  const { own, company, system } = input;
  const companyItems = company?.items ?? null;
  const defaultFrom = companyItems ? "company" : "system";
  if (own?.items) {
    const newer =
      Boolean(companyItems && company?.updatedAt) &&
      (!own.basedOn || Date.parse(company!.updatedAt!) > Date.parse(own.basedOn));
    return { items: own.items, follows: false, defaultFrom, offer: newer };
  }
  return { items: companyItems ?? system, follows: true, defaultFrom, offer: false };
}
