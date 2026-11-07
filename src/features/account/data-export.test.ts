// @vitest-environment node
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { csvCell, EXPORT_TABLES, exportFileName, toCsv } from "./data-export";

vi.mock("server-only", () => ({}));
const { buildAccountExport, EXPORT_PAGE_SIZE } = await import("./server/export-data");

describe("csvCell", () => {
  it("writes empty, numbers, booleans and JSON plainly", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(false)).toBe("false");
    expect(csvCell(["vip", "praha"])).toBe('"[""vip"",""praha""]"');
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell('Novák, "Jan"')).toBe('"Novák, ""Jan"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });

  it("defuses text a spreadsheet would run as a formula", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(csvCell("-cmd")).toBe("'-cmd");
    // Phones and negative amounts stay readable.
    expect(csvCell("+420777123456")).toBe("+420777123456");
    expect(csvCell("-150.5")).toBe("-150.5");
  });
});

describe("toCsv", () => {
  it("starts with a BOM and a header, rows in column order, CRLF", () => {
    const csv = toCsv(["id", "title"], [{ title: "Web", id: "1", extra: "x" }]);
    expect(csv).toBe("\uFEFFid,title\r\n1,Web\r\n");
  });
});

describe("export tables", () => {
  it("cover the data the account has", () => {
    const tables = EXPORT_TABLES.map((spec) => spec.table);
    for (const name of [
      "milestones",
      "tasks",
      "crm_tasks",
      "contacts",
      "deals",
      "calendar_events",
      "transactions",
      "user_settings",
      "profiles",
      "invoices",
      "notes",
    ]) {
      expect(tables).toContain(name);
    }
    expect(new Set(EXPORT_TABLES.map((spec) => spec.file)).size).toBe(EXPORT_TABLES.length);
  });

  it("names the file by the user's day", () => {
    // 23:30 UTC is already the next day in Prague.
    expect(exportFileName("Gradus", new Date("2026-11-01T23:30:00Z"), "Europe/Prague")).toBe(
      "gradus-data-2026-11-02.zip",
    );
  });
});

type Call = {
  table: string;
  select: string;
  eq: [string, string];
  filters: [string, unknown][];
  range: [number, number];
};

/** A client that answers every table from `data` and records what was asked. */
function fakeClient(data: Record<string, Record<string, unknown>[]>, fail?: string) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call = { table, filters: [] as [string, unknown][] } as Call;
      const query = {
        select(columns: string) {
          call.select = columns;
          return query;
        },
        eq(column: string, value: string) {
          call.eq ??= [column, value];
          call.filters.push([column, value]);
          return query;
        },
        order() {
          return query;
        },
        async range(from: number, to: number) {
          call.range = [from, to];
          calls.push(call);
          if (table === fail) return { data: null, error: { message: "boom" } };
          return { data: (data[table] ?? []).slice(from, to + 1), error: null };
        },
      };
      return query;
    },
  };
  return { client: client as never, calls };
}

describe("buildAccountExport", () => {
  it("reads only the user's rows, page by page, one CSV per table", async () => {
    const contacts = Array.from({ length: EXPORT_PAGE_SIZE + 5 }, (_, i) => ({
      id: `c${i}`,
      first_name: `Jan ${i}`,
    }));
    const { client, calls } = fakeClient({
      contacts,
      deals: [{ id: "d1", title: "Web", value: 1000 }],
    });
    const result = await buildAccountExport(client, "user-1");

    expect(calls.every((call) => call.eq[1] === "user-1")).toBe(true);
    expect(calls.find((call) => call.table === "profiles")?.eq[0]).toBe("id");
    // The tutorial's sample data stays out; tables without it are read whole.
    expect(calls.find((call) => call.table === "contacts")?.filters).toContainEqual(["is_demo", false]);
    expect(calls.find((call) => call.table === "notes")?.filters).toContainEqual(["is_demo", false]);
    expect(calls.find((call) => call.table === "transactions")?.filters).toEqual([["user_id", "user-1"]]);
    expect(calls.filter((call) => call.table === "contacts").map((c) => c.range)).toEqual([
      [0, EXPORT_PAGE_SIZE - 1],
      [EXPORT_PAGE_SIZE, 2 * EXPORT_PAGE_SIZE - 1],
    ]);
    expect(result.rows).toBe(contacts.length + 1);
    expect(result.tables).toBe(EXPORT_TABLES.length);

    const files = unzipSync(result.zip);
    expect(Object.keys(files).sort()).toEqual(
      EXPORT_TABLES.map((spec) => `${spec.file}.csv`).sort(),
    );
    // UTF-8 byte order mark first, so spreadsheets read the diacritics.
    expect([...files["deals.csv"].slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const deals = strFromU8(files["deals.csv"].slice(3)).split("\r\n");
    expect(deals[0]).toMatch(/^id,title,/);
    expect(deals[1]).toMatch(/^d1,Web,/);
    expect(strFromU8(files["contacts.csv"]).split("\r\n").length).toBe(contacts.length + 2);
  });

  it("fails as a whole when a table cannot be read", async () => {
    const { client } = fakeClient({}, "deals");
    await expect(buildAccountExport(client, "user-1")).rejects.toThrow(/deals/);
  });
});
