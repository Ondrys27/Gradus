import { describe, expect, it } from "vitest";
import { companySearchString, matchesStatus, parseCompanySearch } from "./search";

const GROUP = "0b6f1c2e-3a4d-4e5f-8a9b-0c1d2e3f4a5b";
const WORKER = "1b6f1c2e-3a4d-4e5f-8a9b-0c1d2e3f4a5b";

describe("company address", () => {
  it("reads the tab and the filters, falling back to the defaults", () => {
    expect(parseCompanySearch(new URLSearchParams(""))).toEqual({
      tab: "people",
      group: null,
      status: "current",
      worker: null,
      workerTab: "overview",
    });
    expect(
      parseCompanySearch(
        new URLSearchParams(`tab=groups&group=${GROUP}&status=ended&worker=${WORKER}&wtab=rights`),
      ),
    ).toEqual({
      tab: "groups",
      group: GROUP,
      status: "ended",
      worker: WORKER,
      workerTab: "rights",
    });
    expect(
      parseCompanySearch(new URLSearchParams("tab=nope&group=../x&status=x&worker=1&wtab=x")),
    ).toMatchObject({ tab: "people", group: null, status: "current", worker: null });
  });

  it("writes only what differs from the defaults and keeps other parameters", () => {
    const params = new URLSearchParams("x=1&tab=rewards");
    expect(companySearchString(params, { tab: "people" })).toBe("x=1");
    expect(companySearchString(params, { group: GROUP })).toBe(`x=1&tab=rewards&group=${GROUP}`);
    expect(companySearchString(new URLSearchParams(`group=${GROUP}`), { group: null })).toBe("");
    expect(companySearchString(new URLSearchParams(""), { status: "ended" })).toBe("status=ended");
  });

  it("opens and closes a dashboard with its tab", () => {
    const open = companySearchString(new URLSearchParams(""), {
      worker: WORKER,
      workerTab: "team",
    });
    expect(open).toBe(`worker=${WORKER}&wtab=team`);
    expect(companySearchString(new URLSearchParams(open), { worker: null })).toBe("");
  });
});

describe("status filter", () => {
  it("hides ended people unless asked for them", () => {
    expect(matchesStatus("inactive", "current")).toBe(false);
    expect(matchesStatus("invited", "current")).toBe(true);
    expect(matchesStatus("inactive", "ended")).toBe(true);
    expect(matchesStatus("active", "all")).toBe(true);
    expect(matchesStatus("active", "invited")).toBe(false);
  });
});
