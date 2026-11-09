import { describe, expect, it } from "vitest";
import type { PlanTransaction } from "./assign";
import { capitalSeries } from "./capital-series";
import { NOVEMBER_CELLS, NOVEMBER_OPENING, NOVEMBER_ROWS } from "./fixtures";

const november = {
  month: { id: "m", month: "2026-11", opening_capital: NOVEMBER_OPENING, reserve: null, currency: "CZK", closed: false },
  rows: NOVEMBER_ROWS,
  cells: NOVEMBER_CELLS,
};
const tx = (over: Partial<PlanTransaction>): PlanTransaction => ({
  id: "t",
  type: "income",
  amount: 1000,
  currency: "CZK",
  category: null,
  description: null,
  occurred_on: "2026-11-03",
  recurring_payment_id: null,
  invoice_id: null,
  deal_id: null,
  contact_id: null,
  ...over,
});

describe("capitalSeries", () => {
  it("plans every week and counts the actuals only for weeks that have begun", () => {
    const points = capitalSeries(
      [november, { month: null, rows: [], cells: [] }],
      [tx({}), tx({ id: "e", type: "expense", amount: 500, occurred_on: "2026-11-10" }), tx({ id: "x", currency: "EUR" })],
      "2026-11-10",
    );
    expect(points.map((point) => point.plan)).toEqual([6500, 16500, 31000, 17000, 17000]);
    expect(points.map((point) => point.actual)).toEqual([9500, 9000, null, null, null]);
  });
});
