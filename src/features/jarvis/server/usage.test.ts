// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { limitReached, planLimits } = await import("./usage");

const plans = [
  { key: "beta", is_default: true, ai_calls_limit: 3000, file_uploads_limit: 500 },
  { key: "pro", is_default: false, ai_calls_limit: 9000, file_uploads_limit: 2000 },
];

describe("planLimits", () => {
  it("uses the subscribed plan", () => {
    expect(planLimits(plans, "pro")).toEqual({ aiCalls: 9000, fileUploads: 2000 });
  });

  it("gives a new user without a subscription the default plan, never 0", () => {
    expect(planLimits(plans, null)).toEqual({ aiCalls: 3000, fileUploads: 500 });
    expect(limitReached({ used: 0, limit: planLimits(plans, null).aiCalls })).toBe(false);
  });

  it("falls back to the default plan when the subscribed plan no longer exists", () => {
    expect(planLimits(plans, "retired")).toEqual({ aiCalls: 3000, fileUploads: 500 });
  });

  it("is 0 only when no plan exists at all", () => {
    expect(planLimits([], null)).toEqual({ aiCalls: 0, fileUploads: 0 });
  });
});
