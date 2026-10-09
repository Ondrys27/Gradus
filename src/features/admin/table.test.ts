import { describe, expect, it } from "vitest";
import { buildTable, type TableData } from "./table";

type Row = { name: string; count: number | null };

const rows: Row[] = [
  { name: "a", count: 3 },
  { name: "b", count: null },
];

describe("buildTable", () => {
  const table = buildTable(rows, [
    { key: "name", label: "Name", render: (row) => row.name.toUpperCase() },
    {
      key: "count",
      label: "Count",
      align: "right",
      render: (row) => (row.count === null ? "–" : `${row.count} ×`),
      csv: (row) => row.count,
    },
  ]);

  it("keeps the header with a default alignment", () => {
    expect(table.columns).toEqual([
      { key: "name", label: "Name", align: "left" },
      { key: "count", label: "Count", align: "right" },
    ]);
  });

  it("renders the shown text and the raw CSV value of every cell", () => {
    expect(table.rows).toEqual([
      { cells: ["A", "3 ×"], csv: ["A", 3] },
      { cells: ["B", "–"], csv: ["B", null] },
    ]);
  });

  it("is plain data that survives the server-to-client boundary", () => {
    expect(JSON.parse(JSON.stringify(table))).toEqual(table);
    const hasFunction = (value: unknown): boolean =>
      typeof value === "function" ||
      (typeof value === "object" && value !== null && Object.values(value).some(hasFunction));
    expect(hasFunction(table)).toBe(false);
  });

  it("only comes from buildTable", () => {
    // @ts-expect-error A hand-made table (that could hide a render function) does not type-check.
    const handMade: TableData = { columns: [], rows: [] };
    expect(handMade.rows).toEqual([]);
  });
});
