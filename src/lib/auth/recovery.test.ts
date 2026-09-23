import { describe, expect, it } from "vitest";
import { isFreshRecoverySession, RECOVERY_WINDOW_SECONDS } from "./recovery";

const now = 1_800_000_000;

describe("isFreshRecoverySession", () => {
  it("accepts a session opened by the reset link within the window", () => {
    expect(isFreshRecoverySession([{ method: "recovery", timestamp: now - 60 }], now)).toBe(true);
    expect(isFreshRecoverySession([{ method: "otp", timestamp: now - 60 }], now)).toBe(true);
  });

  it("rejects an ordinary password session", () => {
    expect(isFreshRecoverySession([{ method: "password", timestamp: now - 60 }], now)).toBe(false);
    expect(isFreshRecoverySession(undefined, now)).toBe(false);
    expect(isFreshRecoverySession(["otp"], now)).toBe(false);
  });

  it("rejects a reset link used longer ago than the window", () => {
    expect(
      isFreshRecoverySession(
        [{ method: "recovery", timestamp: now - RECOVERY_WINDOW_SECONDS - 1 }],
        now,
      ),
    ).toBe(false);
  });
});
