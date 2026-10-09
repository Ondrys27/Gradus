/**
 * Tables of the administration are built on the server and rendered by the
 * client `DataTable`. Functions cannot cross that boundary, so a page describes
 * its columns with `render` / `csv` functions here, and `buildTable` turns them
 * into plain, serializable data: the formatted text of every cell and the raw
 * value for the CSV export.
 *
 * `DataTable` accepts only `TableData`, which carries a type-level brand that
 * only `buildTable` gives out, so passing columns with functions (or a
 * hand-made object that might hide one) does not compile.
 */

export type CsvCell = string | number | null;

export type TableColumn<T> = {
  key: string;
  label: string;
  align?: "left" | "right";
  /** The text shown in the cell; also the CSV cell unless `csv` is given. */
  render: (row: T) => string;
  /** The raw value for the CSV export, when it should differ from the shown text. */
  csv?: (row: T) => CsvCell;
};

export type TableHeader = { key: string; label: string; align: "left" | "right" };
export type TableRow = { cells: string[]; csv: CsvCell[] };

declare const tableBrand: unique symbol;

export type TableData = {
  readonly columns: TableHeader[];
  readonly rows: TableRow[];
  readonly [tableBrand]: true;
};

/** Runs every column over every row on the server; the result is plain data. */
export function buildTable<T>(rows: readonly T[], columns: readonly TableColumn<T>[]): TableData {
  return {
    columns: columns.map(({ key, label, align }) => ({ key, label, align: align ?? "left" })),
    rows: rows.map((row) => {
      const cells = columns.map((column) => column.render(row));
      return {
        cells,
        csv: columns.map((column, index) => (column.csv ? column.csv(row) : cells[index])),
      };
    }),
  } as TableData;
}
