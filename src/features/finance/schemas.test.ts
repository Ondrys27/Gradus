import { describe, expect, it } from "vitest";
import { validateRecurring, validateTransaction } from "./schemas";

const transaction = {
  type: "expense" as const,
  amount: "1 250,50",
  currency: "CZK",
  category: "rent",
  description: "  Office  ",
  occurred_on: "2026-09-01",
};

describe("validateTransaction", () => {
  it("reads a typed amount and trims the description", () => {
    const result = validateTransaction(transaction);
    expect(result).toMatchObject({ ok: true, data: { amount: 1250.5, description: "Office" } });
  });

  it("explains what is wrong, per field", () => {
    expect(validateTransaction({ ...transaction, amount: "0" })).toMatchObject({
      ok: false,
      errors: { amount: "amountInvalid" },
    });
    expect(validateTransaction({ ...transaction, occurred_on: null })).toMatchObject({
      ok: false,
      errors: { occurred_on: "dateRequired" },
    });
    expect(validateTransaction({ ...transaction, category: "made-up" }).ok).toBe(false);
  });
});

describe("validateRecurring", () => {
  const payment = {
    ...transaction,
    frequency: "monthly" as const,
    next_due_on: "2026-10-15",
    ends_on: null,
  };
  it("needs a description and an end after the first payment", () => {
    expect(validateRecurring(payment).ok).toBe(true);
    expect(validateRecurring({ ...payment, description: " " })).toMatchObject({
      ok: false,
      errors: { description: "descriptionRequired" },
    });
    expect(validateRecurring({ ...payment, ends_on: "2026-10-01" })).toMatchObject({
      ok: false,
      errors: { ends_on: "endBeforeStart" },
    });
  });
});
