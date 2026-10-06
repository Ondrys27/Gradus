// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { limitReached, planLimits } = await import("./usage");

describe("planLimits", () => {
  it("reads the numbers of current_plan()", () => {
    expect(
      planLimits({ ai_calls_limit: 1000, file_uploads_limit: 100, read_only: false }),
    ).toEqual({ aiCalls: 1000, fileUploads: 100 });
    expect(limitReached({ used: 0, limit: 1000 })).toBe(false);
  });

  it("leaves nothing after the trial and nothing when the plan cannot be read", () => {
    const expired = planLimits({ ai_calls_limit: 0, file_uploads_limit: 0, read_only: true });
    expect(limitReached({ used: 0, limit: expired.aiCalls })).toBe(true);
    expect(planLimits(null)).toEqual({ aiCalls: 0, fileUploads: 0 });
  });
});
