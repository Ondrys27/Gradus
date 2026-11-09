import { describe, expect, it } from "vitest";
import {
  buildNewMonth,
  nextDue,
  pipelineSuggestions,
  recurringDueDates,
  uniqueLabel,
  type RecurringForPlan,
} from "./carry-over";
import { NOVEMBER_CELLS, NOVEMBER_ROWS } from "./fixtures";

const rent: RecurringForPlan = {
  id: "rec-rent",
  type: "expense",
  amount: 12000,
  currency: "CZK",
  description: "Nájem",
  frequency: "monthly",
  next_due_on: "2026-11-05",
  due_day: 5,
  ends_on: null,
  is_active: true,
};

describe("recurring due dates", () => {
  it("follows the database: the 31st falls on the last day of shorter months", () => {
    expect(nextDue("2027-01-31", "monthly", 31)).toBe("2027-02-28");
    expect(nextDue("2027-02-28", "monthly", 31)).toBe("2027-03-31");
    expect(nextDue("2026-11-30", "quarterly", 30)).toBe("2027-02-28");
    expect(nextDue("2026-12-28", "weekly", null)).toBe("2027-01-04");
  });

  it("lists the days inside a span, from an older next due day too", () => {
    expect(recurringDueDates({ ...rent, next_due_on: "2026-10-05" }, "2026-12-07", "2027-01-03")).toEqual([]);
    expect(recurringDueDates(rent, "2026-11-02", "2026-12-06")).toEqual(["2026-11-05", "2026-12-05"]);
    expect(
      recurringDueDates({ ...rent, frequency: "weekly", due_day: null }, "2026-11-02", "2026-11-22"),
    ).toEqual(["2026-11-05", "2026-11-12", "2026-11-19"]);
    expect(recurringDueDates({ ...rent, ends_on: "2026-11-30" }, "2026-11-02", "2026-12-06")).toEqual(["2026-11-05"]);
    expect(recurringDueDates({ ...rent, is_active: false }, "2026-11-02", "2026-12-06")).toEqual([]);
  });
});

describe("buildNewMonth", () => {
  const previous = { rows: NOVEMBER_ROWS, cells: NOVEMBER_CELLS, weeks: 5 };

  it("copies names only, names with numbers, or only the recurring rows", () => {
    const labels = buildNewMonth({ month: "2026-12", currency: "CZK", previous, mode: "labels", recurring: [], invoices: [] });
    expect(labels.map((row) => [row.kind, row.label, row.cells.length])).toEqual([
      ["income", "Grid", 0],
      ["income", "Fajn Jídlo", 0],
      ["expense", "Nájem", 0],
      ["expense", "Mzdy", 0],
      ["expense", "Software", 0],
    ]);
    const numbers = buildNewMonth({ month: "2026-12", currency: "CZK", previous, mode: "numbers", recurring: [], invoices: [] });
    expect(numbers.find((row) => row.label === "Mzdy")?.cells).toEqual([
      { week: 2, planned: 30000 },
      { week: 4, planned: 14000 },
    ]);
    const onlyRecurring = buildNewMonth({ month: "2026-12", currency: "CZK", previous, mode: "recurring", recurring: [], invoices: [] });
    expect(onlyRecurring).toEqual([]);
  });

  it("puts a fifth week into the last week of a four-week month", () => {
    const rows = buildNewMonth({
      month: "2026-12",
      currency: "CZK",
      previous: { rows: NOVEMBER_ROWS, cells: [{ row_id: "grid", week: 5, planned: 700, note: null }], weeks: 5 },
      mode: "numbers",
      recurring: [],
      invoices: [],
    });
    expect(rows.find((row) => row.label === "Grid")?.cells).toEqual([{ week: 4, planned: 700 }]);
  });

  it("plans recurring payments into their week, never twice, and adds invoices to the client's row", () => {
    const rows = buildNewMonth({
      month: "2026-12",
      currency: "CZK",
      previous,
      mode: "numbers",
      recurring: [
        rent,
        { ...rent, id: "rec-eur", currency: "EUR", description: "Hosting" },
        { ...rent, id: "rec-phone", description: "Telefon", amount: 500, next_due_on: "2026-12-20", due_day: 20 },
      ],
      invoices: [
        { id: "inv-1", contact_id: "c-grid", customer_name: "Grid", due_on: "2026-12-16", total: 20000, currency: "CZK" },
        { id: "inv-2", contact_id: null, customer_name: "Auto Matulka", due_on: "2026-12-30", total: 9000, currency: "CZK" },
        { id: "inv-3", contact_id: null, customer_name: "Mimo", due_on: "2027-01-05", total: 1, currency: "CZK" },
      ],
    });
    // Rent is due on the 5th: 5 December is a Saturday of November's week 5, so December
    // has no due day of it and the copied number stays as the user had it.
    expect(rows.find((row) => row.label === "Nájem")?.cells).toEqual([{ week: 1, planned: 12000 }]);
    expect(rows.find((row) => row.label === "Telefon")).toMatchObject({
      kind: "expense",
      source: "recurring",
      source_id: "rec-phone",
      cells: [{ week: 2, planned: 500 }],
    });
    expect(rows.some((row) => row.label === "Hosting")).toBe(false);
    // The invoice to Grid (due 16 Dec, week 2) goes to the Grid row copied from November.
    expect(rows.find((row) => row.label === "Grid")?.cells).toEqual([{ week: 2, planned: 60000 }]);
    expect(rows.find((row) => row.label === "Auto Matulka")).toMatchObject({
      source: "invoice",
      source_id: "inv-2",
      cells: [{ week: 4, planned: 9000 }],
    });
    expect(rows.some((row) => row.label === "Mimo")).toBe(false);
  });

  it("run twice on the same data gives the same rows", () => {
    const input = { month: "2026-12", currency: "CZK", previous, mode: "numbers" as const, recurring: [rent], invoices: [] };
    expect(buildNewMonth(input)).toEqual(buildNewMonth(input));
  });

  it("names stay unique in a block", () => {
    expect(uniqueLabel("Nájem", ["najem", "Nájem 2"])).toBe("Nájem 3");
    expect(uniqueLabel("Grid", [])).toBe("Grid");
  });
});

describe("pipelineSuggestions", () => {
  it("open deals closing in the month, not yet in the plan, in its currency", () => {
    const suggestions = pipelineSuggestions({
      month: "2026-11",
      currency: "CZK",
      rows: [{ id: "r", kind: "income", label: "Done", position: 0, source: "deal", source_id: "d-accepted" }],
      deals: [
        { id: "d-1", title: "Carwest web", value: 30000, currency: "CZK", expected_close_date: "2026-11-25", open: true },
        { id: "d-accepted", title: "Done", value: 1, currency: "CZK", expected_close_date: "2026-11-25", open: true },
        { id: "d-won", title: "Won", value: 1, currency: "CZK", expected_close_date: "2026-11-25", open: false },
        { id: "d-eur", title: "EUR", value: 1, currency: "EUR", expected_close_date: "2026-11-25", open: true },
        { id: "d-dec", title: "Later", value: 1, currency: "CZK", expected_close_date: "2026-12-10", open: true },
        { id: "d-0", title: "Zero", value: null, currency: "CZK", expected_close_date: "2026-11-25", open: true },
      ],
    });
    expect(suggestions).toEqual([{ dealId: "d-1", label: "Carwest web", week: 4, amount: 30000 }]);
  });
});

describe("a recurring payment due in the month", () => {
  it("replaces the copied numbers of its row instead of adding to them", () => {
    const rows = buildNewMonth({
      month: "2027-01",
      currency: "CZK",
      previous: {
        rows: [{ id: "r", kind: "expense", label: "Nájem", position: 0, source: "manual", source_id: null }],
        cells: [{ row_id: "r", week: 1, planned: 12000, note: null }],
        weeks: 4,
      },
      mode: "numbers",
      recurring: [rent],
      invoices: [],
    });
    // 5 January 2027 is a Tuesday of week 1 (4–10 Jan): 12 000 once, not 24 000.
    expect(rows).toEqual([
      { kind: "expense", label: "Nájem", position: 0, source: "manual", source_id: null, cells: [{ week: 1, planned: 12000 }] },
    ]);
  });
});
