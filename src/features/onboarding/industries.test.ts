import { describe, expect, it } from "vitest";
import { DEFAULT_INDUSTRY, INDUSTRY_KEYS, industryKeyOf } from "./industries";

describe("industryKeyOf", () => {
  it("keeps a known key", () => {
    for (const key of INDUSTRY_KEYS) expect(industryKeyOf(key)).toBe(key);
  });

  it("falls back to the default for anything unknown", () => {
    expect(industryKeyOf(null)).toBe(DEFAULT_INDUSTRY);
    expect(industryKeyOf(undefined)).toBe(DEFAULT_INDUSTRY);
    expect(industryKeyOf("")).toBe(DEFAULT_INDUSTRY);
    expect(industryKeyOf("bogus")).toBe(DEFAULT_INDUSTRY);
  });

  it("has no duplicate keys", () => {
    expect(new Set(INDUSTRY_KEYS).size).toBe(INDUSTRY_KEYS.length);
  });
});
