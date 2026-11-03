import { describe, expect, it } from "vitest";
import { companySearchString, parseCompanySearch } from "./search";

const GROUP = "0b6f1c2e-3a4d-4e5f-8a9b-0c1d2e3f4a5b";

describe("company address", () => {
  it("reads the tab and the group, falling back to people and no filter", () => {
    expect(parseCompanySearch(new URLSearchParams(""))).toEqual({ tab: "people", group: null });
    expect(parseCompanySearch(new URLSearchParams(`tab=groups&group=${GROUP}`))).toEqual({
      tab: "groups",
      group: GROUP,
    });
    expect(parseCompanySearch(new URLSearchParams("tab=nope&group=../x"))).toEqual({
      tab: "people",
      group: null,
    });
  });

  it("writes only what differs from the defaults and keeps other parameters", () => {
    const params = new URLSearchParams("x=1&tab=rewards");
    expect(companySearchString(params, { tab: "people" })).toBe("x=1");
    expect(companySearchString(params, { group: GROUP })).toBe(`x=1&tab=rewards&group=${GROUP}`);
    expect(companySearchString(new URLSearchParams(`group=${GROUP}`), { group: null })).toBe("");
  });
});
