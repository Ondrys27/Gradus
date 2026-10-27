import { describe, expect, it } from "vitest";
import { computeInvoiceTotals, lineTotal } from "./totals";

const item = (quantity: number, unit_price: number, vat_rate = 0) => ({
  quantity,
  unit_price,
  vat_rate,
});

describe("invoice totals", () => {
  it("rounds each line to cents, halves away from zero", () => {
    expect(lineTotal(item(0.5, 0.01))).toBe(0.01);
    expect(lineTotal(item(1.5, 10.01))).toBe(15.02);
    expect(lineTotal(item(0.333, 3))).toBe(1);
    expect(lineTotal(item(0.5, -0.01))).toBe(-0.01);
    expect(lineTotal(item(3, 0.1))).toBe(0.3);
  });

  it("without VAT: the lines and a CZK total rounded to whole crowns", () => {
    const totals = computeInvoiceTotals([item(2, 1250.3), item(1, 99.9)], "none", "CZK");
    expect(totals).toMatchObject({ subtotal: 2600.5, vatTotal: 0, total: 2601, rounding: 0.5 });
    expect(totals.vatLines).toEqual([]);
    // Other currencies keep their cents.
    expect(computeInvoiceTotals([item(2, 1250.3)], "none", "EUR")).toMatchObject({
      total: 2500.6,
      rounding: 0,
    });
  });

  it("ignores the rates of a supplier who is not a VAT payer", () => {
    expect(computeInvoiceTotals([item(1, 1000, 21)], "none", "CZK").total).toBe(1000);
  });

  it("with VAT: one recapitulation line per rate, VAT from the sum of the rate", () => {
    const totals = computeInvoiceTotals(
      [item(1, 0.05, 21), item(1, 0.05, 21), item(3, 100, 12), item(1, 50, 0)],
      "vat",
      "CZK",
    );
    // 0.10 × 21 % = 0.021 → 0.02 (per line it would be 0.01 + 0.01 too, but sums decide).
    expect(totals.vatLines).toEqual([
      { rate: 21, base: 0.1, vat: 0.02 },
      { rate: 12, base: 300, vat: 36 },
      { rate: 0, base: 50, vat: 0 },
    ]);
    expect(totals).toMatchObject({ subtotal: 350.1, vatTotal: 36.02, total: 386, rounding: -0.12 });
  });

  it("rounds VAT half away from zero on the rate's base", () => {
    // 12.50 × 21 % = 2.625 → 2.63
    expect(computeInvoiceTotals([item(1, 12.5, 21)], "vat", "EUR").vatTotal).toBe(2.63);
    // A free rate of a foreign VAT payer: 100 × 19.5 % = 19.50
    expect(computeInvoiceTotals([item(1, 100, 19.5)], "vat", "EUR").total).toBe(119.5);
  });

  it("gives a credit note exactly the negative totals", () => {
    const lines = [item(2, 1250.3, 21), item(1, 99.99, 12)];
    const invoice = computeInvoiceTotals(lines, "vat", "CZK");
    const credit = computeInvoiceTotals(
      lines.map((line) => ({ ...line, unit_price: -line.unit_price })),
      "vat",
      "CZK",
    );
    expect(credit.subtotal).toBe(-invoice.subtotal);
    expect(credit.vatTotal).toBe(-invoice.vatTotal);
    expect(credit.rounding).toBe(-invoice.rounding);
    expect(credit.total).toBe(-invoice.total);
  });

  it("handles large amounts without losing cents", () => {
    expect(computeInvoiceTotals([item(1000000, 999999999.99)], "none", "EUR").total).toBe(
      999999999990000,
    );
    expect(computeInvoiceTotals([], "vat", "CZK")).toMatchObject({ subtotal: 0, total: 0 });
  });
});
