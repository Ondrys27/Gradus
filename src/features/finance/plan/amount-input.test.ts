import { describe, expect, it } from "vitest";
import { decimalMarkOf, parseAmountInput } from "./amount-input";

const cs = (text: string) => parseAmountInput(text, ",");
const en = (text: string) => parseAmountInput(text, ".");

describe("parseAmountInput", () => {
  it("reads the ways people type an amount", () => {
    expect(cs("12500")).toEqual({ ok: true, value: 12500 });
    expect(cs("12 500")).toEqual({ ok: true, value: 12500 });
    expect(cs("12 500")).toEqual({ ok: true, value: 12500 });
    expect(cs("12,5k")).toEqual({ ok: true, value: 12500 });
    expect(cs("12.5k")).toEqual({ ok: true, value: 12500 });
    expect(cs("1,2m")).toEqual({ ok: true, value: 1_200_000 });
    expect(cs("12 500,50")).toEqual({ ok: true, value: 12500.5 });
    expect(cs("12.500")).toEqual({ ok: true, value: 12500 });
    expect(cs("1.234.567")).toEqual({ ok: true, value: 1234567 });
    expect(en("12,500.75")).toEqual({ ok: true, value: 12500.75 });
    expect(en("12,5k")).toEqual({ ok: true, value: 12500 });
    expect(en("1.5")).toEqual({ ok: true, value: 1.5 });
  });

  it("computes simple expressions", () => {
    expect(cs("3*4000")).toEqual({ ok: true, value: 12000 });
    expect(cs("3 × 4 000")).toEqual({ ok: true, value: 12000 });
    expect(cs("=12 000 + 500")).toEqual({ ok: true, value: 12500 });
    expect(cs("(2+3)*1k")).toEqual({ ok: true, value: 5000 });
    expect(cs("10000/3")).toEqual({ ok: true, value: 3333.33 });
    expect(cs("-3000")).toEqual({ ok: true, value: -3000 });
    expect(cs("5000-6000")).toEqual({ ok: true, value: -1000 });
  });

  it("an empty cell clears it, nonsense is refused", () => {
    expect(cs("")).toEqual({ ok: true, value: null });
    expect(cs("   ")).toEqual({ ok: true, value: null });
    for (const bad of ["abc", "12,,5", "3*", "(1+2", "1/0", "1e5", "alert(1)", "1,23,4"]) {
      expect(cs(bad), bad).toEqual({ ok: false });
    }
    expect(cs("9999999999999")).toEqual({ ok: false });
  });

  it("takes the decimal mark from the number format", () => {
    expect(decimalMarkOf("cs-CZ")).toBe(",");
    expect(decimalMarkOf("en-US")).toBe(".");
    expect(decimalMarkOf("de-DE")).toBe(",");
  });
});
