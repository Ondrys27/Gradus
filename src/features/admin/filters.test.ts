import { describe, expect, it } from "vitest";
import {
  activeFilters,
  filtersFor,
  PAGE_FILTERS,
  scopeView,
  sectionOf,
  withoutFilter,
  withoutFilters,
} from "./filters";
import { ADMIN_SECTIONS } from "./nav";
import { DEFAULT_VIEW, parseAdminView, withView, type AdminView } from "./view-state";

const FULL: AdminView = {
  period: "7d",
  from: null,
  to: null,
  compare: false,
  internal: true,
  segment: { plan: "beta", country: "CZ", device: "mobile" },
};

describe("filters per page", () => {
  it("knows every section and gives one user's detail no filters", () => {
    for (const section of ADMIN_SECTIONS) expect(sectionOf(section.href)).toBe(section.key);
    expect(sectionOf("/admin/funkce")).toBe("features");
    expect(sectionOf("/admin/uzivatele")).toBe("users");
    expect(sectionOf("/admin/uzivatele/0b3c")).toBeNull();
    expect(filtersFor("/admin/uzivatele/0b3c")).toEqual([]);
    expect(filtersFor("/admin/audit")).toEqual([]);
    expect(filtersFor("/admin/administratori")).toEqual([]);
  });

  it("offers the Users page the account filters, never a period", () => {
    const users = filtersFor("/admin/uzivatele");
    expect(users).toContain("plan");
    expect(users).toContain("internal");
    expect(users).toContain("country");
    expect(users).toContain("industry");
    expect(users).not.toContain("period");
    expect(users).not.toContain("compare");
    expect(users).not.toContain("device");
  });

  it("offers the device only where one event is one visit", () => {
    const withDevice = (Object.keys(PAGE_FILTERS) as (keyof typeof PAGE_FILTERS)[]).filter((page) =>
      PAGE_FILTERS[page].includes("device"),
    );
    expect(withDevice).toEqual(["explorer"]);
  });

  it("drops what a page does not offer before it computes", () => {
    expect(scopeView(FULL, PAGE_FILTERS.users)).toEqual({
      ...DEFAULT_VIEW,
      compare: false,
      internal: true,
      segment: { plan: "beta", country: "CZ" },
    });
    expect(scopeView(FULL, PAGE_FILTERS.health)).toEqual({
      ...DEFAULT_VIEW,
      period: "7d",
      compare: false,
      internal: false,
      segment: {},
    });
    expect(scopeView(FULL, PAGE_FILTERS.explorer).segment).toEqual(FULL.segment);
  });
});

describe("active filters", () => {
  it("lists only what differs from the default and what the page offers", () => {
    expect(activeFilters(DEFAULT_VIEW, PAGE_FILTERS.overview)).toEqual([]);
    expect(activeFilters(FULL, PAGE_FILTERS.overview)).toEqual([
      { kind: "period" },
      { kind: "compare" },
      { kind: "internal" },
      { kind: "segment", key: "plan", value: "beta" },
      { kind: "segment", key: "country", value: "CZ" },
    ]);
    expect(activeFilters(FULL, PAGE_FILTERS.users)).toHaveLength(3);
    expect(activeFilters(FULL, PAGE_FILTERS.audit)).toEqual([]);
  });

  it("removes one filter back to its default", () => {
    expect(withoutFilter(FULL, { kind: "period" })).toMatchObject({ period: "30d", from: null });
    expect(withoutFilter(FULL, { kind: "compare" }).compare).toBe(true);
    expect(withoutFilter(FULL, { kind: "internal" }).internal).toBe(false);
    expect(withoutFilter(FULL, { kind: "segment", key: "plan", value: "beta" }).segment).toEqual({
      country: "CZ",
      device: "mobile",
    });
  });

  it("clears the page's filters and keeps those of other pages", () => {
    // On the Users page the period and the device are not shown, so they stay.
    expect(withoutFilters(FULL, PAGE_FILTERS.users)).toEqual({
      ...FULL,
      internal: false,
      segment: { device: "mobile" },
    });
    expect(withoutFilters(FULL, PAGE_FILTERS.explorer)).toEqual({ ...DEFAULT_VIEW, compare: false });
  });
});

describe("filters in the address", () => {
  it("round-trip through a shared link", () => {
    const query = withView(new URLSearchParams("tab=pipeline&page=3"), FULL);
    expect(query).toBe("?tab=pipeline&period=7d&cmp=0&internal=1&plan=beta&country=CZ&device=mobile");
    expect(parseAdminView(new URLSearchParams(query.slice(1)))).toEqual(FULL);
  });
});
