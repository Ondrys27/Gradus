import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOCKUP, LOGO_COLORS, MARK, WORDMARK } from "./logo-geometry";

const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");

describe("logo", () => {
  it.each(Object.entries(LOGO_COLORS))("colour %s equals --color-logo-%s", (key, hex) => {
    const match = css.match(new RegExp(`--color-logo-${key}:\\s*(#[0-9a-fA-F]{6})`));
    expect(match?.[1]?.toLowerCase()).toBe(hex);
  });

  it("no theme changes the logo colours", () => {
    const themes = css.slice(css.indexOf("[data-theme="));
    expect(themes).not.toContain("--color-logo-");
  });

  it("bars rise by half a bar to the right and fit the mark", () => {
    const [low, mid, high] = MARK.bars;
    expect(mid.x - low.x).toBe(MARK.bar.width / 2);
    expect(high.x - mid.x).toBe(MARK.bar.width / 2);
    expect(low.y - mid.y).toBe(mid.y - high.y);
    expect(high.x + MARK.bar.width).toBe(MARK.width);
    expect(low.y + MARK.bar.height).toBe(MARK.height);
  });

  it("the name sits right of the mark inside the lockup", () => {
    expect(WORDMARK.x).toBeGreaterThan(MARK.width);
    expect(WORDMARK.x + WORDMARK.width).toBeCloseTo(LOCKUP.width, 1);
    expect(WORDMARK.d.startsWith("M")).toBe(true);
  });
});
