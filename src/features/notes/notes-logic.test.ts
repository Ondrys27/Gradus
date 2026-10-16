import { describe, expect, it } from "vitest";
import {
  daysLeftInTrash,
  groupNotes,
  neighbourAfterRemoval,
  orderBySearch,
  sortNotes,
} from "./notes-logic";

const note = (id: string, updated: string, pinned = false) => ({
  id,
  pinned,
  updated_at: `2026-10-${updated}T10:00:00Z`,
});

describe("notes list", () => {
  it("puts pinned notes first, then the most recently edited", () => {
    const sorted = sortNotes([note("a", "01"), note("b", "05"), note("c", "02", true)]);
    expect(sorted.map((n) => n.id)).toEqual(["c", "b", "a"]);
  });

  it("groups pinned notes apart from the rest", () => {
    const { pinned, others } = groupNotes([note("a", "01", true), note("b", "05")]);
    expect(pinned.map((n) => n.id)).toEqual(["a"]);
    expect(others.map((n) => n.id)).toEqual(["b"]);
  });

  it("orders search results by rank and skips notes that are not in the list", () => {
    const list = [note("a", "01"), note("b", "02"), note("c", "03")];
    expect(orderBySearch(list, ["c", "x", "a"]).map((n) => n.id)).toEqual(["c", "a"]);
  });

  it("selects the next note after a delete, or the previous one at the end", () => {
    const list = [note("a", "03"), note("b", "02"), note("c", "01")];
    expect(neighbourAfterRemoval(list, "a")?.id).toBe("b");
    expect(neighbourAfterRemoval(list, "c")?.id).toBe("b");
    expect(neighbourAfterRemoval([note("a", "01")], "a")).toBeNull();
  });
});

describe("trash", () => {
  it("counts the days left of the 30", () => {
    const now = new Date("2026-10-16T12:00:00Z");
    expect(daysLeftInTrash("2026-10-16T11:00:00Z", now)).toBe(29);
    expect(daysLeftInTrash("2026-09-17T13:00:00Z", now)).toBe(1);
    expect(daysLeftInTrash("2026-09-16T13:00:00Z", now)).toBe(0);
    expect(daysLeftInTrash("2026-09-01T00:00:00Z", now)).toBe(0);
  });
});
