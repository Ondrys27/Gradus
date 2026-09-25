import { describe, expect, it } from "vitest";
import {
  dependencyCandidates,
  fieldOptions,
  newOptionKey,
  nextPosition,
  reorder,
} from "./field-logic";
import type { ContactField } from "./types";

function field(id: string, patch: Partial<ContactField> = {}): ContactField {
  return {
    id,
    table_id: "t",
    label: id,
    type: "text",
    required: false,
    options: null,
    default_value: null,
    depends_on_field_id: null,
    depends_on_value: null,
    position: 0,
    system_key: null,
    ...patch,
  };
}

describe("reorder", () => {
  const items = [
    { id: "a", position: 0 },
    { id: "b", position: 1 },
    { id: "c", position: 2 },
  ];

  it("moves an item and reports only changed positions", () => {
    const { items: next, changes } = reorder(items, "c", "a");
    expect(next.map((item) => item.id)).toEqual(["c", "a", "b"]);
    expect(changes).toEqual([
      { id: "c", position: 0 },
      { id: "a", position: 1 },
      { id: "b", position: 2 },
    ]);
    expect(reorder(items, "a", "a").changes).toEqual([]);
  });

  it("appends after the highest position", () => {
    expect(nextPosition(items)).toBe(3);
    expect(nextPosition([])).toBe(0);
  });
});

describe("fieldOptions", () => {
  it("keeps well-formed options only", () => {
    expect(
      fieldOptions([{ key: "a", label: "A" }, { key: "", label: "x" }, "junk", { key: "b" }]),
    ).toEqual([{ key: "a", label: "A" }]);
    expect(fieldOptions(null)).toEqual([]);
  });

  it("makes keys that do not clash", () => {
    const existing = [{ key: "opt_aaaaaa", label: "A" }];
    expect(newOptionKey(existing)).toMatch(/^opt_[a-z0-9]+$/);
    expect(newOptionKey(existing)).not.toBe("opt_aaaaaa");
  });
});

describe("dependencyCandidates", () => {
  it("offers select questions except the field itself and whatever hangs on it", () => {
    const fields = [
      field("reason", { type: "select", position: 0 }),
      field("sub", { type: "select", position: 1, depends_on_field_id: "reason" }),
      field("subsub", { type: "select", position: 2, depends_on_field_id: "sub" }),
      field("other", { type: "select", position: 3 }),
      field("text", { position: 4 }),
    ];
    expect(dependencyCandidates(fields, "reason").map((f) => f.id)).toEqual(["other"]);
    expect(dependencyCandidates(fields, null).map((f) => f.id)).toEqual([
      "reason",
      "sub",
      "subsub",
      "other",
    ]);
  });
});
