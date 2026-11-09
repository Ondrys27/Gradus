import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { NOVEMBER_CELLS, NOVEMBER_OPENING, NOVEMBER_ROWS } from "./fixtures";
import { columnName, gridToCsv, importPlanCsv, parseCsv, planGrid, type PlanLayoutTexts } from "./layout";
import { planValues } from "./sheet";
import { gridToXlsx, sheetName } from "./xlsx";

const texts: PlanLayoutTexts = {
  title: "Listopad 2026",
  weeks: ["Týden 1", "Týden 2", "Týden 3", "Týden 4", "Týden 5"],
  total: "Celkem",
  opening: "Počáteční kapitál",
  income: "PŘÍJMY",
  incomeTotal: "Příjmy celkem",
  expense: "VÝDAJE",
  expenseTotal: "Výdaje celkem",
  capital: "KAPITÁL",
  balance: "Bilance týdne",
  closing: "Konečný kapitál",
  summary: "Shrnutí měsíce",
  summaryOpening: "Vstupní kapitál",
  summaryIncome: "Příjmy celkem",
  summaryExpense: "Výdaje celkem",
  summaryBalance: "Bilance měsíce",
  summaryClosing: "Konečný kapitál",
  summaryLowest: "Nejnižší stav",
  summaryLowestWeek: "Kdy",
  legend: "Modrá čísla zadáváš, černá se počítají.",
};
const values = planValues(NOVEMBER_ROWS, NOVEMBER_CELLS, 5);
const grid = planGrid({ texts, rows: NOVEMBER_ROWS, values, opening: NOVEMBER_OPENING });
const labelsOf = () => grid.cells.map((line) => line[0]?.v ?? null);

describe("planGrid", () => {
  it("is laid out like the table", () => {
    expect(labelsOf()).toEqual([
      "Listopad 2026",
      "Počáteční kapitál",
      null,
      "PŘÍJMY",
      "Grid",
      "Fajn Jídlo",
      "Příjmy celkem",
      null,
      "VÝDAJE",
      "Nájem",
      "Mzdy",
      "Software",
      "Výdaje celkem",
      null,
      "KAPITÁL",
      "Bilance týdne",
      "Konečný kapitál",
      null,
      "Modrá čísla zadáváš, černá se počítají.",
    ]);
  });

  it("keeps formulas for what is computed, with the values cached", () => {
    const closing = grid.cells[16];
    expect(closing.slice(1).map((cell) => cell.v)).toEqual([6500, 16500, 31000, 17000, 17000, 17000]);
    expect(closing[1].f).toBe("B2+B16");
    expect(grid.cells[1][2]).toMatchObject({ v: 6500, f: "B17", style: "computed" });
    expect(grid.cells[1][1]).toMatchObject({ v: 8500, style: "input" });
    expect(grid.cells[6][6]).toMatchObject({ v: 74500, f: "SUM(G5:G6)" });
    expect(grid.cells[4][6]).toMatchObject({ v: 40000, f: "SUM(B5:F5)" });
    // The summary, two columns right of Total.
    expect(grid.cells[6][8]?.v).toBe("Nejnižší stav");
    expect(grid.cells[6][9]).toMatchObject({ v: 6500, f: "MIN(B17:F17)" });
    expect(grid.cells[7][9]?.v).toBe("Týden 1");
  });

  it("names columns past Z", () => {
    expect(columnName(0)).toBe("A");
    expect(columnName(25)).toBe("Z");
    expect(columnName(26)).toBe("AA");
  });
});

describe("CSV export and import", () => {
  it("comes back as the same month", () => {
    const csv = gridToCsv(grid);
    expect(csv.startsWith("﻿Listopad 2026,Týden 1")).toBe(true);
    const imported = importPlanCsv(csv, { weeks: 5, decimal: "," });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.plan.opening).toBe(8500);
    expect(imported.plan.rows.map((row) => [row.kind, row.label, row.cells])).toEqual([
      ["income", "Grid", [{ week: 2, planned: 40000 }]],
      ["income", "Fajn Jídlo", [{ week: 1, planned: 10000 }, { week: 3, planned: 24500 }]],
      ["expense", "Nájem", [{ week: 1, planned: 12000 }]],
      ["expense", "Mzdy", [{ week: 2, planned: 30000 }, { week: 4, planned: 14000 }]],
      ["expense", "Software", [{ week: 3, planned: 10000 }]],
    ]);
  });

  it("reads the owner's sheet: semicolons, Kč, spaces, four weeks into a five-week month", () => {
    const csv = [
      "Listopad;Týden 1;Týden 2;Týden 3;Týden 4;Celkem;;Shrnutí měsíce;",
      'Počáteční kapitál;"8 500 Kč";6 500 Kč;;;8 500 Kč;;Vstupní kapitál;8 500 Kč',
      "PŘÍJMY;;;;;;;;",
      "Grid;;40 000 Kč;;;40 000 Kč;;;",
      "Carwest;;;\"12,5k\";;;;;",
      "Příjmy celkem;0;40 000;12 500;0;52 500;;;",
      "VÝDAJE;;;;;;;;",
      "Nájem;12 000 Kč;;;;;;;",
      "grid;1;;;;;;;",
      "Výdaje celkem;12 000;;;;;;;",
      "KAPITÁL;;;;;;;;",
      "Bilance týdne;-12 000;;;;;;;",
      "Konečný kapitál;-3 500;;;;;;;",
    ].join("\n");
    const imported = importPlanCsv(csv, { weeks: 4, decimal: "," });
    expect(imported).toMatchObject({ ok: true });
    if (!imported.ok) return;
    expect(imported.plan.opening).toBe(8500);
    expect(imported.plan.rows.map((row) => [row.kind, row.label, row.cells])).toEqual([
      ["income", "Grid", [{ week: 2, planned: 40000 }]],
      ["income", "Carwest", [{ week: 3, planned: 12500 }]],
      ["expense", "Nájem", [{ week: 1, planned: 12000 }]],
      ["expense", "grid", [{ week: 1, planned: 1 }]],
    ]);
  });

  it("refuses a file that is not a plan, or too large", () => {
    expect(importPlanCsv("name,email\nJan,jan@example.com", { weeks: 5, decimal: "," })).toEqual({
      ok: false,
      problem: "notPlanLayout",
    });
    expect(importPlanCsv("x".repeat(600 * 1024), { weeks: 5, decimal: "," })).toEqual({ ok: false, problem: "tooLarge" });
    expect(importPlanCsv("\u0000\u0001garbage\"\"\";;;", { weeks: 5, decimal: "," })).toMatchObject({ ok: false });
  });

  it("parses quotes, doubled quotes and line breaks inside fields", () => {
    expect(parseCsv('a,"b ""c""","d\ne"\r\n1,2,3')).toEqual([
      ["a", 'b "c"', "d\ne"],
      ["1", "2", "3"],
    ]);
  });
});

describe("XLSX", () => {
  it("is a workbook with the sheet, styles and formulas", () => {
    const files = unzipSync(gridToXlsx(grid, "Listopad 2026"));
    expect(Object.keys(files).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
    ]);
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain('<c r="B17" s="4"><f>B2+B16</f><v>6500</v></c>');
    expect(sheet).toContain('<c r="B2" s="2"><v>8500</v></c>');
    expect(sheet).toContain("Fajn Jídlo");
    expect(strFromU8(files["xl/styles.xml"])).toContain('rgb="FF0000FF"');
    expect(strFromU8(files["xl/workbook.xml"])).toContain('name="Listopad 2026"');
  });

  it("keeps sheet names within Excel's rules", () => {
    expect(sheetName("A/B: [x]")).toBe("A B   x");
    expect(sheetName("x".repeat(40))).toHaveLength(31);
  });
});
