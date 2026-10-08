import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIEW,
  MAX_RANGE_DAYS,
  metricParams,
  parseAdminView,
  previousRange,
  rangeLength,
  resolveRange,
  serializeAdminView,
  viewQuery,
} from "./view-state";

const TODAY = "2026-10-08";

describe("admin view in the address", () => {
  it("falls back to the defaults for an empty or broken address", () => {
    expect(parseAdminView({})).toEqual(DEFAULT_VIEW);
    expect(parseAdminView({ period: "forever", cmp: "maybe", internal: "yes" })).toEqual(
      DEFAULT_VIEW,
    );
  });

  it("round-trips every control", () => {
    const view = parseAdminView(
      new URLSearchParams(
        "period=custom&from=2026-09-01&to=2026-09-30&cmp=0&internal=1&plan=pro&mode=tool&industry=realEstate&locale=cs&country=CZ&role=worker&device=mobile",
      ),
    );
    expect(view).toEqual({
      period: "custom",
      from: "2026-09-01",
      to: "2026-09-30",
      compare: false,
      internal: true,
      segment: {
        plan: "pro",
        mode: "tool",
        industry: "realEstate",
        locale: "cs",
        country: "CZ",
        role: "worker",
        device: "mobile",
      },
    });
    expect(parseAdminView(serializeAdminView(view))).toEqual(view);
  });

  it("leaves defaults out of the address", () => {
    expect(viewQuery(DEFAULT_VIEW)).toBe("");
    expect(viewQuery({ ...DEFAULT_VIEW, period: "7d" })).toBe("?period=7d");
  });

  it("drops segment values that are not allowed", () => {
    const view = parseAdminView({
      plan: "gold",
      device: "fridge",
      country: "cz",
      industry: "x'; drop table",
      signup_week: "2026-09-28",
    });
    expect(view.segment).toEqual({});
  });

  it("ignores a custom period with a broken or reversed range", () => {
    expect(parseAdminView({ period: "custom", from: "2026-02-30", to: "2026-03-01" }).period).toBe(
      "30d",
    );
    expect(parseAdminView({ period: "custom", from: "2026-03-02", to: "2026-03-01" }).period).toBe(
      "30d",
    );
  });
});

describe("ranges", () => {
  it("ends the preset periods today", () => {
    expect(resolveRange({ ...DEFAULT_VIEW, period: "today" }, TODAY)).toEqual({
      from: TODAY,
      to: TODAY,
    });
    expect(resolveRange({ ...DEFAULT_VIEW, period: "7d" }, TODAY)).toEqual({
      from: "2026-10-02",
      to: TODAY,
    });
    expect(rangeLength(resolveRange({ ...DEFAULT_VIEW, period: "12m" }, TODAY))).toBe(365);
  });

  it("cuts a custom range at today and at the longest allowed length", () => {
    const future = {
      ...DEFAULT_VIEW,
      period: "custom" as const,
      from: "2026-10-01",
      to: "2027-01-01",
    };
    expect(resolveRange(future, TODAY)).toEqual({ from: "2026-10-01", to: TODAY });
    const long = {
      ...DEFAULT_VIEW,
      period: "custom" as const,
      from: "2020-01-01",
      to: "2026-01-01",
    };
    expect(rangeLength(resolveRange(long, TODAY))).toBe(MAX_RANGE_DAYS);
  });

  it("compares with the same number of days right before", () => {
    expect(previousRange({ from: "2026-10-02", to: "2026-10-08" })).toEqual({
      from: "2026-09-25",
      to: "2026-10-01",
    });
    expect(previousRange({ from: TODAY, to: TODAY })).toEqual({
      from: "2026-10-07",
      to: "2026-10-07",
    });
  });

  it("passes internal accounts and the segment to the metric functions", () => {
    const view = { ...DEFAULT_VIEW, internal: true, segment: { plan: "beta" } };
    expect(metricParams(view, { from: "2026-10-01", to: TODAY })).toEqual({
      from: "2026-10-01",
      to: TODAY,
      includeInternal: true,
      segment: { plan: "beta" },
    });
  });
});
