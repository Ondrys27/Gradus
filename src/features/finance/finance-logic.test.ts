import { describe, expect, it } from "vitest";
import {
  balanceOf,
  chartRange,
  clampWindow,
  dailyChartRows,
  displayInvoiceStatus,
  fullWindow,
  monthlyChartRows,
  pageCount,
  panWindow,
  periodRange,
  zoomedRange,
  zoomWindow,
} from "./finance-logic";

describe("periodRange", () => {
  it("covers whole months, both ends included", () => {
    expect(periodRange("thisMonth", "2026-02-10")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(periodRange("lastMonth", "2026-01-15")).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
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
    expect(displayInvoiceStatus({ status: "cancelled", due_on: "2026-01-01" }, today)).toBe(
      "closed",
    );
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

describe("chart rows", () => {
  it("carries a running income total across days", () => {
    const rows = dailyChartRows([
      { day: "2026-09-01", income: 100, expense: 30 },
      { day: "2026-09-02", income: 0, expense: 0 },
      { day: "2026-09-03", income: 50.5, expense: 10 },
    ]);
    expect(rows).toEqual([
      { key: "2026-09-01", income: 100, expense: 30, cumulativeIncome: 100 },
      { key: "2026-09-02", income: 0, expense: 0, cumulativeIncome: 100 },
      { key: "2026-09-03", income: 50.5, expense: 10, cumulativeIncome: 150.5 },
    ]);
  });

  it("carries a running income total across months", () => {
    const rows = monthlyChartRows([
      { month: "2026-08-01", income: 10, expense: 5 },
      { month: "2026-09-01", income: 20, expense: 5 },
    ]);
    expect(rows.map((row) => row.cumulativeIncome)).toEqual([10, 30]);
  });
});

describe("zoom window", () => {
  it("starts full and never shrinks below two bars", () => {
    expect(fullWindow(31)).toEqual({ start: 0, end: 30 });
    expect(clampWindow(31, { start: 10, end: 10 })).toEqual({ start: 10, end: 11 });
  });

  it("keeps the window inside the data and preserves its size", () => {
    expect(clampWindow(10, { start: 8, end: 12 })).toEqual({ start: 5, end: 9 });
    expect(clampWindow(10, { start: -3, end: 1 })).toEqual({ start: 0, end: 4 });
  });

  it("zooms around the cursor fraction and clamps to the minimum size", () => {
    expect(zoomWindow(10, { start: 0, end: 9 }, 0.5, 0.5)).toEqual({ start: 3, end: 7 });
    expect(zoomWindow(10, { start: 3, end: 7 }, 0.1, 0.5)).toEqual({ start: 5, end: 6 });
    expect(zoomWindow(10, { start: 0, end: 3 }, 3, 0)).toEqual({ start: 0, end: 9 });
  });

  it("pans by a number of bars and stops at the edges", () => {
    expect(panWindow(10, { start: 3, end: 7 }, 2)).toEqual({ start: 5, end: 9 });
    expect(panWindow(10, { start: 3, end: 7 }, -5)).toEqual({ start: 0, end: 4 });
  });
});

describe("zoomedRange", () => {
  it("covers exactly the zoomed days in the Month view", () => {
    const rows = dailyChartRows([
      { day: "2026-09-01", income: 0, expense: 0 },
      { day: "2026-09-02", income: 0, expense: 0 },
      { day: "2026-09-03", income: 0, expense: 0 },
    ]);
    expect(zoomedRange("month", rows, { start: 1, end: 2 })).toEqual({
      from: "2026-09-02",
      to: "2026-09-03",
    });
  });

  it("covers whole months in the Year view", () => {
    const rows = monthlyChartRows([
      { month: "2026-08-01", income: 0, expense: 0 },
      { month: "2026-09-01", income: 0, expense: 0 },
    ]);
    expect(zoomedRange("year", rows, { start: 0, end: 1 })).toEqual({
      from: "2026-08-01",
      to: "2026-09-30",
    });
  });
});
