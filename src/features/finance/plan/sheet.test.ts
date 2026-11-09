import { describe, expect, it } from "vitest";
import { NOVEMBER_CELLS, NOVEMBER_OPENING, NOVEMBER_ROWS } from "./fixtures";
import {
  cashLowFinding,
  computeSheet,
  diffValues,
  isEmptyRow,
  kindsOf,
  OTHER_ROW,
  planValues,
  projectedValues,
} from "./sheet";

const plan = planValues(NOVEMBER_ROWS, NOVEMBER_CELLS, 5);
const november = computeSheet({ weeks: 5, opening: NOVEMBER_OPENING, kinds: kindsOf(NOVEMBER_ROWS), values: plan });

describe("the month sheet", () => {
  it("matches the owner's November to the crown", () => {
    expect(november.summary).toEqual({
      opening: 8500,
      income: 74500,
      expense: 66000,
      balance: 8500,
      closing: 17000,
      lowest: { value: 6500, week: 1 },
      warning: null,
    });
    expect(november.income.weeks).toEqual([10000, 40000, 24500, 0, 0]);
    expect(november.expense.weeks).toEqual([12000, 30000, 10000, 14000, 0]);
    expect(november.balance.weeks).toEqual([-2000, 10000, 14500, -14000, 0]);
    expect(november.closing.weeks).toEqual([6500, 16500, 31000, 17000, 17000]);
  });

  it("carries the closing capital to the next week's opening; Total of the opening is week 1", () => {
    expect(november.opening.weeks).toEqual([8500, 6500, 16500, 31000, 17000]);
    expect(november.opening.total).toBe(8500);
    expect(november.closing.total).toBe(17000);
    expect(november.rows.get("fajn")?.total).toBe(34500);
  });

  it("warns below zero and below the reserve", () => {
    expect(
      computeSheet({ weeks: 5, opening: 1000, kinds: kindsOf(NOVEMBER_ROWS), values: plan }).summary,
    ).toMatchObject({ lowest: { value: -1000, week: 1 }, warning: "negative" });
    expect(
      computeSheet({ weeks: 5, opening: 8500, kinds: kindsOf(NOVEMBER_ROWS), values: plan, reserve: 10000 })
        .summary.warning,
    ).toBe("reserve");
  });

  it("sums in cents", () => {
    const rows = [{ id: "a", kind: "income" as const, label: "A", position: 0, source: "manual" as const, source_id: null }];
    const values = planValues(
      rows,
      [
        { row_id: "a", week: 1, planned: 0.1, note: null },
        { row_id: "a", week: 2, planned: 0.2, note: null },
      ],
      4,
    );
    expect(computeSheet({ weeks: 4, opening: 0, kinds: kindsOf(rows), values }).summary.income).toBe(0.3);
  });

  it("the earliest week wins a tie for the lowest point", () => {
    const sheet = computeSheet({ weeks: 4, opening: 100, kinds: new Map(), values: new Map() });
    expect(sheet.summary.lowest).toEqual({ value: 100, week: 1 });
  });

  it("differences and the projection mix plan and actuals", () => {
    const actual = new Map([["grid", [0, 35000, 0, 0, 0]]]);
    expect(diffValues(plan, actual, 5).get("grid")).toEqual([0, -5000, 0, 0, 0]);
    expect(projectedValues(plan, actual, 5, 2).get("fajn")).toEqual([0, 0, 24500, 0, 0]);
    expect(isEmptyRow("grid", plan)).toBe(false);
    expect(isEmptyRow(OTHER_ROW.income, plan)).toBe(true);
  });
});

describe("cashLowFinding", () => {
  const rows = NOVEMBER_ROWS;
  it("names the week, the cause and the incomes that have not come", () => {
    // After week 1 Fajn Jídlo paid nothing: the 10 000 is missing and rent (12 000) is paid.
    const actual = new Map([
      ["rent", [12000, 0, 0, 0, 0]],
      ["fajn", [0, 0, 0, 0, 0]],
    ]);
    const finding = cashLowFinding({ rows, plan, actual, weeks: 5, pastWeeks: 1, opening: 8500, reserve: 5000 });
    // Week 1 really ended at -3 500, week 2 plans +10 000 → 6 500, week 3 +14 500 → 21 000,
    // week 4 -14 000 → 7 000: nothing below 5 000 from now on except week 2? 6 500 ≥ 5 000.
    expect(finding).toBeNull();
    const tight = cashLowFinding({ rows, plan, actual, weeks: 5, pastWeeks: 1, opening: 8500, reserve: 8000 });
    expect(tight).toEqual({
      week: 2,
      closing: 6500,
      threshold: 8000,
      cause: { label: "Mzdy", amount: 30000 },
      missingIncomes: 1,
    });
  });

  it("says nothing about a month that is over, warns below zero without a reserve", () => {
    expect(cashLowFinding({ rows, plan, actual: new Map(), weeks: 5, pastWeeks: 5, opening: 0, reserve: null })).toBeNull();
    const finding = cashLowFinding({ rows, plan, actual: new Map(), weeks: 5, pastWeeks: 0, opening: 1000, reserve: null });
    expect(finding).toMatchObject({ week: 1, closing: -1000, threshold: 0, cause: { label: "Nájem" } });
  });
});
