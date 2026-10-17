import { describe, expect, it } from "vitest";
import {
  budgetSnapshot,
  budgetStatus,
  DEFAULT_MONTHLY_BUDGET_USD,
  monthlyBudgetUsd,
  projectedMonthSpend,
  utcMonthStart,
} from "./budget";

describe("monthlyBudgetUsd", () => {
  it("reads the variable and falls back to 90 for anything unusable", () => {
    expect(monthlyBudgetUsd("120")).toBe(120);
    expect(monthlyBudgetUsd("45.5")).toBe(45.5);
    for (const raw of [undefined, "", " ", "abc", "0", "-5", "Infinity"]) {
      expect(monthlyBudgetUsd(raw)).toBe(DEFAULT_MONTHLY_BUDGET_USD);
    }
  });
});

describe("budgetStatus", () => {
  it("is near from 80 % and paused from 100 %", () => {
    expect(budgetStatus(0, 90)).toBe("ok");
    expect(budgetStatus(71.99, 90)).toBe("ok");
    expect(budgetStatus(72, 90)).toBe("near");
    expect(budgetStatus(89.99, 90)).toBe("near");
    expect(budgetStatus(90, 90)).toBe("paused");
    expect(budgetStatus(130, 90)).toBe("paused");
  });

  it("follows the threshold set in the administration", () => {
    expect(budgetStatus(44.99, 90, 0.5)).toBe("ok");
    expect(budgetStatus(45, 90, 0.5)).toBe("near");
    expect(budgetStatus(89.99, 90, 1)).toBe("ok");
  });

  it("is paused at once with a cap of 0", () => {
    expect(budgetStatus(0, 0)).toBe("paused");
    expect(budgetSnapshot({ spentUsd: 0, calls: 0 }, 0, new Date()).share).toBe(1);
  });
});

describe("the month", () => {
  it("starts on the 1st at 00:00 UTC", () => {
    expect(utcMonthStart(new Date("2026-10-31T23:30:00-02:00")).toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );
    expect(utcMonthStart(new Date("2026-10-12T08:00:00Z")).toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });

  it("projects the spend to the month's end at the pace so far", () => {
    // 10 of 31 days of October gone, 20 USD spent: 62 USD by the end.
    expect(projectedMonthSpend(20, new Date("2026-10-11T00:00:00Z"))).toBeCloseTo(62, 6);
    // On the last instant the projection is the spend itself.
    expect(projectedMonthSpend(50, new Date("2026-11-01T00:00:00Z"))).toBeCloseTo(50 * 30, 6);
    expect(projectedMonthSpend(50, new Date("2026-10-31T23:59:59.999Z"))).toBeCloseTo(50, 3);
  });

  it("counts the first hours of a month as one day", () => {
    // 2 USD in the first hour would be 1,488 USD at that pace; as one day it is 62.
    expect(projectedMonthSpend(2, new Date("2026-10-01T01:00:00Z"))).toBeCloseTo(62, 6);
  });
});

describe("budgetSnapshot", () => {
  it("puts spend, share, pace and status together", () => {
    expect(
      budgetSnapshot({ spentUsd: 45, calls: 812 }, 90, new Date("2026-10-16T00:00:00Z")),
    ).toEqual({
      spentUsd: 45,
      budgetUsd: 90,
      calls: 812,
      share: 0.5,
      warnShare: 0.8,
      projectedUsd: 93,
      status: "ok",
    });
  });
});
