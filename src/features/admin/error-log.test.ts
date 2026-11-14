import { describe, expect, it } from "vitest";
import { cameBack, errorLogSearch, parseErrorLogFilters, stackHead, statusChange } from "./error-log";

const FP = "0123456789abcdef0123456789abcdef";

describe("parseErrorLogFilters", () => {
  it("reads the log's part of the address, ignoring what it does not know", () => {
    expect(
      parseErrorLogFilters({ status: "resolved", code: " gr-ab12 ", latest: "1", group: FP, page: "2" }),
    ).toEqual({
      tab: "log",
      status: "resolved",
      code: "GR-AB12",
      rawCode: " gr-ab12 ",
      latest: true,
      group: FP,
      page: 2,
    });
    expect(parseErrorLogFilters({ status: "fixed", group: "nope", page: "-3", tab: "alerts" })).toMatchObject({
      tab: "alerts",
      status: null,
      group: null,
      page: 0,
      code: null,
    });
  });
});

describe("errorLogSearch", () => {
  it("writes the filters and keeps the shared view", () => {
    expect(errorLogSearch({ status: "new", latest: true }, "?period=7d")).toBe("?status=new&latest=1&period=7d");
    expect(errorLogSearch({}, "")).toBe("");
    expect(errorLogSearch({ tab: "alerts" })).toBe("?tab=alerts");
  });
});

describe("cameBack", () => {
  it("labels a resolved error that happened again until it is resolved again", () => {
    expect(cameBack("new", "2026-11-13T10:00:00Z")).toBe(true);
    expect(cameBack("in_progress", "2026-11-13T10:00:00Z")).toBe(true);
    expect(cameBack("resolved", "2026-11-13T10:00:00Z")).toBe(false);
    expect(cameBack("ignored", "2026-11-13T10:00:00Z")).toBe(false);
    expect(cameBack("new", null)).toBe(false);
  });
});

describe("statusChange", () => {
  it("stamps when an error was resolved, and clears it otherwise", () => {
    expect(statusChange("resolved", "T")).toEqual({ status: "resolved", resolved_at: "T", returned_at: null });
    expect(statusChange("new", "T")).toEqual({ status: "new", resolved_at: null });
  });

  it("drops the return when the error is closed, keeps it while it is looked at", () => {
    expect(statusChange("ignored", "T")).toEqual({ status: "ignored", resolved_at: null, returned_at: null });
    expect(statusChange("in_progress", "T")).not.toHaveProperty("returned_at");
  });
});

describe("stackHead", () => {
  it("keeps the first ten non-empty lines", () => {
    const stack = Array.from({ length: 15 }, (_, i) => `at f${i} (x.js:${i})`).join("\n\n");
    expect(stackHead(stack)?.split("\n")).toHaveLength(10);
    expect(stackHead(null)).toBeNull();
    expect(stackHead("\n \n")).toBeNull();
  });
});
