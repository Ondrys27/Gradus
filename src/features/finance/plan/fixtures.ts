import type { PlanCell, PlanRow } from "./sheet";

/**
 * The owner's November 2026 as in the sheet the plan replaces: opening 8 500,
 * two incomes of 74 500 together, three expenses of 66 000; the month ends
 * with 17 000 and is lowest (6 500) in week 1. Week 5 stays empty.
 */
export const NOVEMBER_ROWS: PlanRow[] = [
  { id: "grid", kind: "income", label: "Grid", position: 0, source: "manual", source_id: null },
  { id: "fajn", kind: "income", label: "Fajn Jídlo", position: 1, source: "manual", source_id: null },
  { id: "rent", kind: "expense", label: "Nájem", position: 0, source: "manual", source_id: null },
  { id: "pay", kind: "expense", label: "Mzdy", position: 1, source: "manual", source_id: null },
  { id: "soft", kind: "expense", label: "Software", position: 2, source: "manual", source_id: null },
];

export const NOVEMBER_CELLS: PlanCell[] = [
  { row_id: "fajn", week: 1, planned: 10000, note: null },
  { row_id: "grid", week: 2, planned: 40000, note: null },
  { row_id: "fajn", week: 3, planned: 24500, note: null },
  { row_id: "rent", week: 1, planned: 12000, note: null },
  { row_id: "pay", week: 2, planned: 30000, note: null },
  { row_id: "pay", week: 4, planned: 14000, note: null },
  { row_id: "soft", week: 3, planned: 10000, note: null },
];

export const NOVEMBER_OPENING = 8500;
