import { describe, expect, it } from "vitest";
import type { LayoutItem } from "./grid";
import { resolveMain } from "./resolve";

const layout = (widget: string): LayoutItem[] => [
  { id: "a", widget, size: "M", x: 0, y: 0, settings: {} },
];
const system = layout("today");

describe("resolveMain", () => {
  it("follows the system default when nothing else is set", () => {
    expect(resolveMain({ own: null, company: null, system })).toEqual({
      items: system,
      follows: true,
      defaultFrom: "system",
      offer: false,
    });
  });

  it("follows the company default live while the person changed nothing", () => {
    const company = { items: layout("pipeline"), updatedAt: "2026-11-20T10:00:00Z" };
    expect(resolveMain({ own: null, company, system })).toMatchObject({
      items: company.items,
      follows: true,
      defaultFrom: "company",
    });
    // A main tab reset to the default (items null) follows again.
    expect(resolveMain({ own: { items: null, basedOn: null }, company, system }).follows).toBe(
      true,
    );
  });

  it("keeps the own layout and offers a newer company default", () => {
    const own = { items: layout("level"), basedOn: "2026-11-20T10:00:00Z" };
    const same = { items: layout("pipeline"), updatedAt: "2026-11-20T10:00:00Z" };
    const newer = { items: layout("pipeline"), updatedAt: "2026-11-21T08:00:00Z" };
    expect(resolveMain({ own, company: same, system })).toMatchObject({
      items: own.items,
      follows: false,
      offer: false,
    });
    expect(resolveMain({ own, company: newer, system })).toMatchObject({
      items: own.items,
      offer: true,
    });
    // Own layout made before the company had any default: the first one is offered.
    expect(resolveMain({ own: { ...own, basedOn: null }, company: same, system }).offer).toBe(true);
    // No company default: nothing to offer.
    expect(resolveMain({ own, company: null, system }).offer).toBe(false);
  });
});
