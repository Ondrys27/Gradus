import { describe, expect, it } from "vitest";
import type { PlanTransaction } from "@/features/finance/plan/assign";
import { NOVEMBER_CELLS, NOVEMBER_OPENING, NOVEMBER_ROWS } from "@/features/finance/plan/fixtures";
import type { LoadedPlan } from "@/features/finance/plan/load";
import { DEFAULT_FORMAT_SETTINGS } from "@/lib/format";
import { cashLowDedupeKey, cashLowInputOf, cashPlanOf, describeCashPlan } from "./cash-plan";

const settings = { ...DEFAULT_FORMAT_SETTINGS, currency: "CZK" };
const plan = (reserve: number | null): LoadedPlan => ({
  month: {
    id: "m",
    month: "2026-11",
    opening_capital: NOVEMBER_OPENING,
    reserve,
    currency: "CZK",
    closed: false,
  },
  rows: NOVEMBER_ROWS,
  cells: NOVEMBER_CELLS,
});
const rent: PlanTransaction = {
  id: "t1",
  type: "expense",
  amount: 12000,
  currency: "CZK",
  category: "rent",
  description: null,
  occurred_on: "2026-11-03",
  recurring_payment_id: null,
  invoice_id: null,
  deal_id: null,
  contact_id: null,
};
const names = { rent: ["Nájem", "Rent"] };

describe("cashPlanOf", () => {
  it("knows the plan's closing and lowest point; a fine month has no warning", () => {
    const result = cashPlanOf({
      plan: plan(null),
      transactions: [],
      today: "2026-11-02",
      categoryNames: names,
    });
    expect(result).toMatchObject({
      month: "2026-11",
      weeks: 5,
      pastWeeks: 0,
      closing: 17000,
      lowest: { value: 6500, week: 1 },
      finding: null,
    });
  });

  it("warns from the actuals so far and the plan from now on", () => {
    // Week 1 is over: the rent was paid, Fajn Jídlo's 10 000 did not come.
    const result = cashPlanOf({
      plan: plan(8000),
      transactions: [rent],
      today: "2026-11-10",
      categoryNames: names,
    });
    expect(result?.pastWeeks).toBe(1);
    expect(result?.finding).toEqual({
      week: 2,
      closing: 6500,
      threshold: 8000,
      cause: { label: "Mzdy", amount: 30000 },
      missingIncomes: 1,
    });
    const input = cashLowInputOf(result);
    expect(input).toMatchObject({
      month: "2026-11",
      week: 2,
      threshold: 8000,
      currency: "CZK",
      missingIncomes: 1,
    });
    expect(cashLowDedupeKey(input!)).toBe(cashLowDedupeKey({ ...input! }));
  });

  it("without a month there is no plan at all", () => {
    expect(
      cashPlanOf({
        plan: { month: null, rows: [], cells: [] },
        transactions: [],
        today: "2026-11-02",
        categoryNames: names,
      }),
    ).toBeNull();
    expect(cashLowInputOf(null)).toBeNull();
  });

  it("describes the plan for the model in the plan's currency", () => {
    const result = cashPlanOf({
      plan: plan(8000),
      transactions: [rent],
      today: "2026-11-10",
      categoryNames: names,
    })!;
    const text = describeCashPlan(result, settings);
    expect(text).toContain(
      "Finance plan 2026-11 (5 weeks, Monday to Sunday; week 2 is the current one)",
    );
    expect(text).toContain("planned closing capital 17 000 Kč");
    expect(text).toContain("lowest 6 500 Kč at the end of week 1");
    expect(text).toContain("drops to 6 500 Kč at the end of week 2, below the reserve 8 000 Kč");
    expect(text).toContain('"Mzdy" 30 000 Kč');
    expect(text).toContain("1 planned income(s)");
  });
});
