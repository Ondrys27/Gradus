import { describe, expect, it } from "vitest";
import type { WidgetMeta } from "./catalog";
import { recommendWidgets } from "./recommend";

const meta = (
  key: string,
  category: WidgetMeta["category"],
  nav?: WidgetMeta["requires"]["nav"],
): WidgetMeta => ({
  key,
  category,
  sizes: ["M"],
  defaultSize: "M",
  requires: nav ? { nav } : {},
  settings: [],
  href: "/app",
});

const catalog = [
  meta("today", "today"),
  meta("overdueTasks", "today", "tasks"),
  meta("pipeline", "sales", "pipeline"),
  meta("winRate", "sales", "pipeline"),
  meta("financeMonth", "money", "finance"),
  meta("milestones", "progress", "milestones"),
  meta("grady", "tools"),
];

describe("recommendWidgets", () => {
  it("never suggests what is on the board", () => {
    const keys = recommendWidgets(catalog, ["pipeline", "today"], new Set()).map((m) => m.key);
    expect(keys).not.toContain("pipeline");
    expect(keys).not.toContain("today");
  });

  it("puts the sections the person uses first, then the board's categories", () => {
    const keys = recommendWidgets(catalog, ["pipeline"], new Set(["finance"])).map((m) => m.key);
    // finance is used (3); winRate shares the board's category (2); the rest by order.
    expect(keys.slice(0, 2)).toEqual(["financeMonth", "winRate"]);
  });

  it("keeps the catalog order on ties and respects the limit", () => {
    const keys = recommendWidgets(catalog, [], new Set(), 3).map((m) => m.key);
    expect(keys).toEqual(["today", "grady", "overdueTasks"]);
  });
});
