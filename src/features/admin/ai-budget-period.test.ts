import { describe, expect, it } from "vitest";
import { DEFAULT_FORMAT_SETTINGS } from "@/lib/format";
import {
  budgetPeriod,
  daysInMonth,
  describePeriod,
  isWholeMonth,
  monthShare,
  periodFigures,
  scaleCap,
} from "./ai-budget-period";
import { DEFAULT_VIEW, resolveRange, type AdminView } from "./view-state";

const MONTHLY = 90;

function periodFor(view: Partial<AdminView>, today: string) {
  const full: AdminView = { ...DEFAULT_VIEW, ...view };
  return budgetPeriod(full, resolveRange(full, today), today);
}

describe("days of a month", () => {
  it("knows February, leap years and long months", () => {
    expect(daysInMonth("2027-02-10")).toBe(28);
    expect(daysInMonth("2028-02-10")).toBe(29);
    expect(daysInMonth("2027-03-31")).toBe(31);
    expect(daysInMonth("2026-11-01")).toBe(30);
  });

  it("recognises a whole calendar month", () => {
    expect(isWholeMonth({ from: "2027-02-01", to: "2027-02-28" })).toBe(true);
    expect(isWholeMonth({ from: "2027-02-01", to: "2027-02-27" })).toBe(false);
    expect(isWholeMonth({ from: "2027-02-02", to: "2027-03-01" })).toBe(false);
  });
});

describe("caps scaled to the period", () => {
  it("keeps the monthly cap for 30 days (the calendar month the check counts)", () => {
    const period = periodFor({ period: "30d" }, "2026-10-20");
    expect(period.kind).toBe("month");
    expect(scaleCap(MONTHLY, period)).toBe(90);
  });

  it("gives 7 days in February a larger weekly cap than 7 days in March", () => {
    const february = periodFor({ period: "7d" }, "2027-02-15");
    const march = periodFor({ period: "7d" }, "2027-03-15");
    expect(february.capKind).toBe("weekly");
    expect(scaleCap(MONTHLY, february)).toBeCloseTo((90 * 7) / 28, 10); // 22.50
    expect(scaleCap(MONTHLY, march)).toBeCloseTo((90 * 7) / 31, 10); // 20.32
    expect(scaleCap(MONTHLY, february)).toBeGreaterThan(scaleCap(MONTHLY, march));
  });

  it("counts 7 days by the current month even when they start in the previous one", () => {
    const period = periodFor({ period: "7d" }, "2027-03-03");
    expect(period.kind === "month" ? null : period.spend).toEqual({
      from: "2027-02-25",
      to: "2027-03-03",
    });
    expect(scaleCap(MONTHLY, period)).toBeCloseTo((90 * 7) / 31, 10);
  });

  it("gives today the monthly cap divided by the days of the month", () => {
    const february = periodFor({ period: "today" }, "2027-02-10");
    expect(february.capKind).toBe("daily");
    expect(scaleCap(MONTHLY, february)).toBeCloseTo(90 / 28, 10);
    expect(scaleCap(MONTHLY, periodFor({ period: "today" }, "2026-10-20"))).toBeCloseTo(90 / 31, 10);
  });

  it("sums the daily caps of each month for a range over two months", () => {
    const period = periodFor(
      { period: "custom", from: "2027-02-20", to: "2027-03-10" },
      "2027-04-01",
    );
    expect(period.capKind).toBe("period");
    // 9 days of February at 90/28, 10 days of March at 90/31.
    expect(scaleCap(MONTHLY, period)).toBeCloseTo((9 * 90) / 28 + (10 * 90) / 31, 10);
    expect(scaleCap(MONTHLY, period)).toBeCloseTo(57.96, 2);
  });

  it("gives a whole calendar month exactly the monthly cap, future days included", () => {
    const past = periodFor({ period: "custom", from: "2027-02-01", to: "2027-02-28" }, "2027-05-01");
    expect(past.capKind).toBe("monthly");
    expect(scaleCap(MONTHLY, past)).toBeCloseTo(90, 10);

    const current = periodFor({ period: "custom", from: "2026-10-01", to: "2026-10-31" }, "2026-10-20");
    if (current.kind === "month") throw new Error("expected a custom period");
    expect(current.spend).toEqual({ from: "2026-10-01", to: "2026-10-20" });
    expect(current.capRange).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(scaleCap(MONTHLY, current)).toBeCloseTo(90, 10);
  });

  it("scales 90 days and 12 months by their length", () => {
    const quarter = periodFor({ period: "90d" }, "2026-10-20");
    if (quarter.kind === "month") throw new Error("expected a range");
    expect(scaleCap(MONTHLY, quarter)).toBeCloseTo(90 * monthShare(quarter.spend), 10);
    expect(quarter.factor).toBeGreaterThan(2.9);
    expect(quarter.factor).toBeLessThan(3.0);
    const year = periodFor({ period: "12m" }, "2026-10-20");
    expect(year.factor).toBeCloseTo(12, 1);
  });

  it("scales the per-user cap and the warning threshold the same way", () => {
    const week = periodFor({ period: "7d" }, "2027-02-15");
    expect(scaleCap(5, week)).toBeCloseTo(1.25, 10);
    expect(scaleCap(MONTHLY, week) * 0.8).toBeCloseTo(18, 10);
  });
});

describe("the figures of the budget card", () => {
  const month = { spentUsd: 40, calls: 300, budgetUsd: 90, warnShare: 0.8 };

  it("shows the calendar month for 30 days", () => {
    const figures = periodFigures(periodFor({ period: "30d" }, "2026-10-20"), month, null);
    expect(figures).toMatchObject({ spentUsd: 40, calls: 300, capUsd: 90, status: "ok" });
    expect(figures.share).toBeCloseTo(40 / 90, 10);
  });

  it("compares the period's spend with the scaled cap and threshold", () => {
    const week = periodFor({ period: "7d" }, "2027-02-15"); // cap 22.50, warning at 18
    expect(periodFigures(week, month, { spentUsd: 12.4, calls: 80 })).toMatchObject({
      spentUsd: 12.4,
      calls: 80,
      status: "ok",
    });
    expect(periodFigures(week, month, { spentUsd: 19, calls: 1 }).status).toBe("near");
    expect(periodFigures(week, month, { spentUsd: 23, calls: 1 }).status).toBe("paused");
  });

  it("counts a zero cap as used up", () => {
    const week = periodFor({ period: "7d" }, "2027-02-15");
    const figures = periodFigures(week, { ...month, budgetUsd: 0 }, { spentUsd: 0, calls: 0 });
    expect(figures.capUsd).toBe(0);
    expect(figures.share).toBe(1);
  });
});

describe("the period in words", () => {
  const t = (key: string, values?: Record<string, string>) =>
    values ? `${key} ${values.from}–${values.to}` : key;

  it("names presets by their key and custom ranges by their dates", () => {
    expect(describePeriod(periodFor({ period: "7d" }, "2026-10-20"), t, DEFAULT_FORMAT_SETTINGS)).toBe(
      "7d",
    );
    expect(
      describePeriod(
        periodFor({ period: "custom", from: "2026-09-01", to: "2026-10-31" }, "2026-10-20"),
        t,
        DEFAULT_FORMAT_SETTINGS,
      ),
    ).toBe("custom 1. 9. 2026–31. 10. 2026");
  });
});
