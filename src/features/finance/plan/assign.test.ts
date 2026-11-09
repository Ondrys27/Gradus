import { describe, expect, it } from "vitest";
import { actualValues, assignTransactions, normalizeLabel, transactionsOfCell, type PlanTransaction } from "./assign";
import { OTHER_ROW, type PlanRow } from "./sheet";

const rows: PlanRow[] = [
  { id: "client", kind: "income", label: "Grid", position: 0, source: "contact", source_id: "contact-1" },
  { id: "deal", kind: "income", label: "Web pro Carwest", position: 1, source: "deal", source_id: "deal-1" },
  { id: "rent", kind: "expense", label: "Nájem", position: 0, source: "recurring", source_id: "rec-1" },
  { id: "soft", kind: "expense", label: "software", position: 1, source: "manual", source_id: null },
  { id: "fuel", kind: "expense", label: "Benzín", position: 2, source: "manual", source_id: null },
];

let n = 0;
function tx(over: Partial<PlanTransaction>): PlanTransaction {
  n += 1;
  return {
    id: `t${String(n).padStart(3, "0")}`,
    type: "expense",
    amount: 100,
    currency: "CZK",
    category: null,
    description: null,
    occurred_on: "2026-11-10",
    recurring_payment_id: null,
    invoice_id: null,
    deal_id: null,
    contact_id: null,
    ...over,
  };
}

const categoryNames = { rent: ["Nájem", "Rent"], software: ["Software", "Software"], otherExpense: ["Ostatní výdaje", "Other expense"] };

describe("assignTransactions", () => {
  const transactions = [
    tx({ recurring_payment_id: "rec-1", amount: 12000, occurred_on: "2026-11-02" }),
    tx({ type: "income", invoice_id: "inv-9", contact_id: "contact-1", amount: 40000 }),
    tx({ type: "income", deal_id: "deal-1", contact_id: "contact-1", amount: 5000, occurred_on: "2026-11-17" }),
    tx({ category: "software", amount: 990 }),
    tx({ category: "rent", amount: 1 }),
    tx({ description: "  benzin ", amount: 800 }),
    tx({ category: "otherExpense", amount: 50 }),
    tx({ type: "income", category: "sales", amount: 300 }),
    tx({ amount: 999, currency: "EUR" }),
    tx({ amount: 777, occurred_on: "2026-11-01" }),
  ];
  const assigned = assignTransactions({ month: "2026-11", currency: "CZK", rows, transactions, categoryNames });

  it("by source first, then category, then description, else Other", () => {
    expect(assigned.map((a) => [a.rowId, a.week, a.transaction.amount])).toEqual([
      ["rent", 1, 12000],
      ["client", 2, 40000],
      // The deal row is the deal's own; its contact would be second choice.
      ["deal", 3, 5000],
      ["soft", 2, 990],
      ["rent", 2, 1],
      ["fuel", 2, 800],
      [OTHER_ROW.expense, 2, 50],
      [OTHER_ROW.income, 2, 300],
    ]);
  });

  it("leaves out other currencies and days of another month", () => {
    expect(assigned.some((a) => a.transaction.currency === "EUR")).toBe(false);
    expect(assigned.some((a) => a.transaction.occurred_on === "2026-11-01")).toBe(false);
  });

  it("is the same answer whatever order the transactions come in", () => {
    const again = assignTransactions({
      month: "2026-11",
      currency: "CZK",
      rows: [...rows].reverse(),
      transactions: [...transactions].reverse(),
      categoryNames,
    });
    const key = (list: typeof assigned) =>
      list.map((a) => `${a.transaction.id}>${a.rowId}`).sort();
    expect(key(again)).toEqual(key(assigned));
  });

  it("sums the actuals per row and week and lists a cell's transactions", () => {
    const values = actualValues(assigned, rows, 5);
    expect(values.get("rent")).toEqual([12000, 1, 0, 0, 0]);
    expect(values.get(OTHER_ROW.income)).toEqual([0, 300, 0, 0, 0]);
    expect(transactionsOfCell(assigned, "rent", 2).map((t) => t.amount)).toEqual([1]);
  });

  it("normalizes names without diacritics and case", () => {
    expect(normalizeLabel("  Nájem   kanceláře ")).toBe("najem kancelare");
  });
});
