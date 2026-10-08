import { describe, expect, it } from "vitest";
import { npsEligible } from "./nps-trigger";

const NOW = new Date("2026-10-08T12:00:00Z");

describe("npsEligible", () => {
  it("waits for seven full days of use", () => {
    expect(npsEligible("2026-10-02T12:00:00Z", null, NOW)).toBe(false);
    expect(npsEligible("2026-10-01T12:00:00Z", null, NOW)).toBe(true);
    expect(npsEligible("2026-09-01T12:00:00Z", null, NOW)).toBe(true);
  });

  it("never asks again once it has been asked", () => {
    expect(npsEligible("2026-01-01T00:00:00Z", "2026-10-01T00:00:00Z", NOW)).toBe(false);
  });
});
