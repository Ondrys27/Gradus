import { describe, expect, it } from "vitest";
import {
  balanceOf,
  chartRange,
  displayInvoiceStatus,
  pageCount,
  periodRange,
} from "./finance-logic";

describe("periodRange", () => {
  it("covers whole months, both ends included", () => {
    expect(periodRange("thisMonth", "2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange("lastMonth", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(periodRange("last3Months", "2026-09-25")).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
    });
    expect(periodRange("thisYear", "2026-09-25")).toEqual({ from: "2026-01-01", to: "2026-09-30" });
  });

  it("charts twelve months ending with the current one", () => {
    expect(chartRange("2026-09-25")).toEqual({ from: "2025-10-01", to: "2026-09-30" });
    expect(periodRange("last12Months", "2026-09-25")).toEqual(chartRange("2026-09-25"));
  });
});

describe("displayInvoiceStatus", () => {
  const today = "2026-09-25";
  it("derives overdue from the due day and leaves paid alone", () => {
    expect(displayInvoiceStatus({ status: "open", due_on: "2026-09-24" }, today)).toBe("overdue");
    expect(displayInvoiceStatus({ status: "sent", due_on: "2026-09-25" }, today)).toBe("pending");
    expect(displayInvoiceStatus({ status: "open", due_on: null }, today)).toBe("pending");
    expect(displayInvoiceStatus({ status: "paid", due_on: "2026-01-01" }, today)).toBe("paid");
    expect(displayInvoiceStatus({ status: "cancelled", due_on: "2026-01-01" }, today)).toBe("closed");
    expect(displayInvoiceStatus({ status: "draft", due_on: "2026-01-01" }, today)).toBe("draft");
  });
});

describe("totals", () => {
  it("balances to whole cents and always has one page", () => {
    expect(balanceOf({ income: 0.3, expense: 0.1 })).toBe(0.2);
    expect(pageCount(0)).toBe(1);
    expect(pageCount(41)).toBe(3);
  });
});
