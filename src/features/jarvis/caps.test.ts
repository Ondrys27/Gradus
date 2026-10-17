import { describe, expect, it } from "vitest";
import {
  aiCapsFormSchema,
  remainingUsd,
  resolveAiCaps,
  toStoredAiCaps,
  userAllowed,
  userCapFormSchema,
  userCapModeOf,
  userLimit,
} from "./caps";

describe("resolveAiCaps", () => {
  it("falls back to JARVIS_MONTHLY_BUDGET_USD, no per-user cap and 80 % without a row", () => {
    expect(resolveAiCaps(null, "120")).toEqual({
      monthlyUsd: 120,
      perUserUsd: null,
      warnShare: 0.8,
      source: "default",
    });
    expect(resolveAiCaps(null, undefined).monthlyUsd).toBe(90);
  });

  it("reads the stored value, 0 included", () => {
    expect(
      resolveAiCaps({ monthly_usd: 0, per_user_usd: 2.5, warn_percent: 60 }, "120"),
    ).toEqual({ monthlyUsd: 0, perUserUsd: 2.5, warnShare: 0.6, source: "database" });
  });

  it("ignores a broken value instead of lifting the cap", () => {
    for (const broken of [
      { monthly_usd: -1, per_user_usd: null, warn_percent: 80 },
      { monthly_usd: "90", per_user_usd: null, warn_percent: 80 },
      { per_user_usd: null, warn_percent: 80 },
      "90",
    ]) {
      expect(resolveAiCaps(broken, "70")).toMatchObject({ monthlyUsd: 70, source: "default" });
    }
  });
});

describe("userLimit", () => {
  const caps = { perUserUsd: 5 };

  it("blocking wins, then the user's own cap, then the app-wide per-user cap", () => {
    expect(userLimit(caps, { capUsd: 50, blocked: true })).toEqual({ kind: "blocked" });
    expect(userLimit(caps, { capUsd: 50, blocked: false })).toEqual({
      kind: "cap",
      usd: 50,
      source: "override",
    });
    expect(userLimit(caps, null)).toEqual({ kind: "cap", usd: 5, source: "global" });
    expect(userLimit({ perUserUsd: null }, null)).toEqual({ kind: "none" });
  });

  it("an own cap may be lower or higher than the app-wide one", () => {
    expect(userLimit(caps, { capUsd: 1, blocked: false })).toMatchObject({ usd: 1 });
    expect(userLimit({ perUserUsd: null }, { capUsd: 3, blocked: false })).toMatchObject({
      usd: 3,
    });
  });
});

describe("userAllowed", () => {
  it("stops at the cap, never for no limit, always when blocked", () => {
    const cap = { kind: "cap", usd: 5, source: "global" } as const;
    expect(userAllowed(cap, 4.99)).toBe(true);
    expect(userAllowed(cap, 5)).toBe(false);
    expect(userAllowed({ kind: "none" }, 10_000)).toBe(true);
    expect(userAllowed({ kind: "blocked" }, 0)).toBe(false);
  });

  it("remaining never goes below zero", () => {
    expect(remainingUsd(5, 3.5)).toBe(1.5);
    expect(remainingUsd(5, 7)).toBe(0);
  });
});

describe("aiCapsFormSchema", () => {
  it("takes the form's text, decimal comma included, and an empty per-user cap", () => {
    const parsed = aiCapsFormSchema.parse({
      monthlyUsd: "120,5",
      perUserUsd: " ",
      warnPercent: "75",
    });
    expect(parsed).toEqual({ monthlyUsd: 120.5, perUserUsd: null, warnPercent: 75 });
    expect(toStoredAiCaps(parsed)).toEqual({
      monthly_usd: 120.5,
      per_user_usd: null,
      warn_percent: 75,
    });
  });

  it("allows a monthly cap of 0 but nothing negative or above the maximum", () => {
    const base = { perUserUsd: "", warnPercent: "80" };
    expect(aiCapsFormSchema.safeParse({ ...base, monthlyUsd: "0" }).success).toBe(true);
    for (const monthlyUsd of ["-1", "10000.01", "abc", "", "1.234"]) {
      expect(aiCapsFormSchema.safeParse({ ...base, monthlyUsd }).success, monthlyUsd).toBe(false);
    }
  });

  it("wants a positive per-user cap up to 1,000 and a whole threshold of 1–100", () => {
    const base = { monthlyUsd: "90" };
    for (const [perUserUsd, warnPercent, ok] of [
      ["5", "80", true],
      ["1000", "100", true],
      ["0", "80", false],
      ["1000.5", "80", false],
      ["5", "0", false],
      ["5", "101", false],
      ["5", "80.5", false],
      ["5", "", false],
    ] as const) {
      expect(
        aiCapsFormSchema.safeParse({ ...base, perUserUsd, warnPercent }).success,
        `${perUserUsd} ${warnPercent}`,
      ).toBe(ok);
    }
  });
});

describe("userCapFormSchema", () => {
  it("needs an amount only for an own cap", () => {
    expect(userCapFormSchema.parse({ mode: "default" })).toEqual({ mode: "default" });
    expect(userCapFormSchema.parse({ mode: "blocked" })).toEqual({ mode: "blocked" });
    expect(userCapFormSchema.parse({ mode: "cap", capUsd: "2,5" })).toEqual({
      mode: "cap",
      capUsd: 2.5,
    });
    for (const capUsd of ["", "0", "-2", "1001"]) {
      expect(userCapFormSchema.safeParse({ mode: "cap", capUsd }).success, capUsd).toBe(false);
    }
  });

  it("names the saved exception", () => {
    expect(userCapModeOf(null)).toBe("default");
    expect(userCapModeOf({ capUsd: 3, blocked: false })).toBe("cap");
    expect(userCapModeOf({ capUsd: null, blocked: true })).toBe("blocked");
  });
});
