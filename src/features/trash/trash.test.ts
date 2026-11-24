import { describe, expect, it } from "vitest";
import { restorableUntil, trashEntriesOf, validRetention } from "./trash";

describe("trash entries", () => {
  it("keeps the main row of a deleting tool with every row it deleted", () => {
    const records = [
      {
        table: "tasks" as const,
        match: { id: "sub" },
        op: "delete" as const,
        row: { title: "Sub" },
      },
      {
        table: "tasks" as const,
        match: { id: "top" },
        op: "delete" as const,
        row: { title: "Top" },
      },
    ];
    expect(trashEntriesOf("delete_task", records)).toEqual([
      { kind: "task", recordId: "sub", title: "Sub", records },
    ]);
    expect(trashEntriesOf("create_task", records)).toEqual([]);
    expect(trashEntriesOf("delete_event", records)).toEqual([]);
  });

  it("names a transaction by its description and keeps the retention in range", () => {
    const [entry] = trashEntriesOf("delete_transaction", [
      { table: "transactions", match: { id: "t" }, op: "delete", row: { description: "Nájem" } },
    ]);
    expect(entry.title).toBe("Nájem");
    expect(restorableUntil("2026-11-24T10:00:00.000Z", 7)).toBe("2026-12-01T10:00:00.000Z");
    expect(validRetention(7)).toBe(true);
    expect(validRetention(0)).toBe(false);
    expect(validRetention(91)).toBe(false);
    expect(validRetention(1.5)).toBe(false);
  });
});
