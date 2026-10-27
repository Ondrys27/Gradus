import { describe, expect, it } from "vitest";
import { moveItem, parseDecimal, parseItems, shiftDays, type ItemDraft } from "./editor-logic";

const draftItem = (id: string, patch: Partial<ItemDraft> = {}): ItemDraft => ({
  id,
  name: "Web",
  quantity: "1",
  unit: "ks",
  unit_price: "100",
  vat_rate: "21",
  ...patch,
});

describe("invoice form", () => {
  it("reads numbers typed the Czech or the English way", () => {
    expect(parseDecimal("1 250,50", 2)).toBe(1250.5);
    expect(parseDecimal("1250.5", 2)).toBe(1250.5);
    expect(parseDecimal("-3", 2)).toBe(-3);
    expect(parseDecimal("2,125", 3)).toBe(2.125);
    expect(parseDecimal("1,005", 2)).toBeNaN();
    expect(parseDecimal("12a", 2)).toBeNaN();
    expect(parseDecimal("", 2)).toBeNaN();
  });

  it("turns the items into numbers and names the fields that are not", () => {
    const { items, errors } = parseItems(
      [draftItem("a", { unit_price: "" }), draftItem("b", { quantity: "x", vat_rate: "150" })],
      "vat",
    );
    expect(items[0]).toMatchObject({ unit_price: 0, quantity: 1, vat_rate: 21 });
    expect(errors).toEqual({ b: { quantity: "quantityInvalid", vat_rate: "rateInvalid" } });
    // Without VAT the rate is not read at all.
    expect(parseItems([draftItem("c", { vat_rate: "abc" })], "none").errors).toEqual({});
  });

  it("moves an item by drag and drop and counts days across months", () => {
    const list = [draftItem("a"), draftItem("b"), draftItem("c")];
    expect(moveItem(list, "c", "a").map((item) => item.id)).toEqual(["c", "a", "b"]);
    expect(moveItem(list, "a", "missing")).toBe(list);
    expect(shiftDays("2026-10-25", 14)).toBe("2026-11-08");
    expect(shiftDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
