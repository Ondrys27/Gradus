import { describe, expect, it } from "vitest";
import {
  addItem,
  arrange,
  cleanItems,
  columnsFor,
  hasCollision,
  moveItem,
  removeItem,
  resizeItem,
  rowsOf,
  WIDGET_SIZES,
  withPositions,
  type LayoutItem,
  type WidgetSize,
} from "./grid";

function item(id: string, size: WidgetSize): LayoutItem {
  return { id, widget: "today", size, x: 0, y: 0, settings: {} };
}

function positions(items: LayoutItem[], cols = 4) {
  return Object.fromEntries(arrange(items, cols).map((p) => [p.id, [p.x, p.y, p.w, p.h]]));
}

describe("arrange (first fit in order)", () => {
  it("places in reading order and fills a gap with a later small widget", () => {
    const layout = [item("a", "L"), item("b", "M"), item("c", "S"), item("d", "S"), item("e", "S")];
    expect(positions(layout)).toEqual({
      a: [0, 0, 2, 2],
      b: [2, 0, 2, 1],
      c: [2, 1, 1, 1],
      d: [3, 1, 1, 1],
      e: [0, 2, 1, 1],
    });
  });

  it("puts XL on its own full rows", () => {
    expect(positions([item("a", "S"), item("b", "XL"), item("c", "S")])).toEqual({
      a: [0, 0, 1, 1],
      b: [0, 1, 4, 2],
      c: [1, 0, 1, 1],
    });
  });

  it("never overlaps, whatever the order and the width", () => {
    // A deterministic pseudo random sweep over orders and sizes.
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    for (let round = 0; round < 300; round += 1) {
      const count = 1 + (next() % 14);
      const layout = Array.from({ length: count }, (_, index) =>
        item(`i${index}`, WIDGET_SIZES[next() % WIDGET_SIZES.length]),
      );
      for (const cols of [4, 2]) {
        const placements = arrange(layout, cols);
        expect(placements).toHaveLength(count);
        expect(hasCollision(placements, cols)).toBe(false);
      }
    }
  });
});

describe("a narrower grid", () => {
  it("keeps the order and stretches L and XL across the two columns", () => {
    const layout = [
      item("a", "S"),
      item("b", "XL"),
      item("c", "L"),
      item("d", "S"),
      item("e", "M"),
    ];
    expect(positions(layout, 2)).toEqual({
      a: [0, 0, 1, 1],
      b: [0, 1, 2, 2],
      c: [0, 3, 2, 2],
      d: [1, 0, 1, 1],
      e: [0, 5, 2, 1],
    });
  });

  it("is four columns only from a wide grid", () => {
    expect(columnsFor(1200)).toBe(4);
    expect(columnsFor(880)).toBe(4);
    expect(columnsFor(879)).toBe(2);
    expect(columnsFor(358)).toBe(2);
  });

  it("counts the rows", () => {
    expect(rowsOf(arrange([item("a", "L"), item("b", "S")], 2))).toBe(3);
  });
});

describe("editing", () => {
  const base = withPositions([item("a", "M"), item("b", "S"), item("c", "S"), item("d", "L")]);

  it("moves an item and the others make room", () => {
    const moved = moveItem(base, "d", 0);
    expect(moved.map((entry) => entry.id)).toEqual(["d", "a", "b", "c"]);
    expect(moved.find((entry) => entry.id === "d")).toMatchObject({ x: 0, y: 0 });
    expect(moved.find((entry) => entry.id === "a")).toMatchObject({ x: 2, y: 0 });
  });

  it("resizes and reflows without collisions", () => {
    const resized = resizeItem(base, "b", "XL");
    expect(hasCollision(arrange(resized, 4), 4)).toBe(false);
    expect(resized.find((entry) => entry.id === "b")).toMatchObject({ size: "XL", x: 0, y: 1 });
  });

  it("adds a widget to the first free place", () => {
    const sparse = withPositions([item("a", "L"), item("b", "M")]);
    const added = addItem(sparse, item("n", "S"));
    expect(added.find((entry) => entry.id === "n")).toMatchObject({ x: 2, y: 1 });
  });

  it("removes and closes the hole", () => {
    const removed = removeItem(base, "a");
    expect(removed.find((entry) => entry.id === "b")).toMatchObject({ x: 0, y: 0 });
  });
});

describe("cleanItems", () => {
  it("keeps well formed items and drops the rest", () => {
    const cleaned = cleanItems([
      { id: "a", widget: "today", size: "L", x: 9, y: 9, settings: { scope: "mine" } },
      { id: "a", widget: "pipeline", size: "M" },
      { id: "b", widget: "bad key!", size: "S" },
      { id: "c", widget: "level", size: "XXL" },
      { id: "d", widget: "level", size: "S", settings: "nope" },
      "text",
      null,
    ]);
    expect(cleaned).toEqual([
      { id: "a", widget: "today", size: "L", x: 0, y: 0, settings: { scope: "mine" } },
      { id: "d", widget: "level", size: "S", x: 2, y: 0, settings: {} },
    ]);
  });

  it("refuses what is not a list", () => {
    expect(cleanItems({})).toEqual([]);
    expect(cleanItems(null)).toEqual([]);
  });

  it("drops oversized settings", () => {
    expect(
      cleanItems([{ id: "a", widget: "today", size: "S", settings: { t: "x".repeat(3000) } }]),
    ).toEqual([]);
  });
});
