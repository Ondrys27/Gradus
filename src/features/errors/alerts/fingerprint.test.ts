// @vitest-environment node
import { describe, expect, it } from "vitest";
import { errorFingerprint, normalizeForFingerprint } from "./fingerprint";

const base = { message: "TypeError: x is undefined", page: "/app/finance", source: "boundary" };

describe("errorFingerprint", () => {
  it("is 32 hex characters and the same for the same message at the same place", () => {
    const value = errorFingerprint(base);
    expect(value).toMatch(/^[0-9a-f]{32}$/);
    expect(errorFingerprint({ ...base })).toBe(value);
  });

  it("ignores what changes between two occurrences of one bug", () => {
    expect(
      errorFingerprint({
        ...base,
        message: "Error: row 12 of 3f2b9c1e-1d2a-4c3b-8e9f-0a1b2c3d4e5f",
      }),
    ).toBe(
      errorFingerprint({
        ...base,
        message: "error:  ROW 7 of 00000000-0000-4000-8000-000000000001",
      }),
    );
    expect(normalizeForFingerprint("Index 12 out of range  ")).toBe("index # out of range");
  });

  it("stays the same across deployments, whose built files have other hashes", () => {
    expect(
      errorFingerprint({
        ...base,
        message:
          "ChunkLoadError: Loading chunk 8392 failed. (error: https://gradus.app/_next/static/chunks/8392-3f9a1b2c4d5e6f70.js)",
      }),
    ).toBe(
      errorFingerprint({
        ...base,
        message:
          "ChunkLoadError: Loading chunk 517 failed. (error: https://gradus.app/_next/static/chunks/517-a0b1c2d3e4f5a6b7.js)",
      }),
    );
    expect(normalizeForFingerprint("build 9f86d081884c7d65 broke")).toBe("build :hash broke");
    // Plain words stay words.
    expect(normalizeForFingerprint("decade facade")).toBe("decade facade");
  });

  it("tells apart another message, page, source or action", () => {
    const value = errorFingerprint(base);
    expect(errorFingerprint({ ...base, message: "TypeError: y is undefined" })).not.toBe(value);
    expect(errorFingerprint({ ...base, page: "/app/pipeline" })).not.toBe(value);
    expect(errorFingerprint({ ...base, source: "onerror" })).not.toBe(value);
    expect(errorFingerprint({ ...base, action: "/app/finance/page" })).not.toBe(value);
  });
});
