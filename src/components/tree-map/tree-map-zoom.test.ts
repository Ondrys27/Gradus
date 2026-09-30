import { describe, expect, it } from "vitest";
import {
  clampScale,
  easeOutCubic,
  MAX_SCALE,
  MIN_SCALE,
  normalizeWheelDelta,
  wheelZoomFactor,
  zoomFrame,
} from "./tree-map-zoom";

const wheel = (deltaY: number, patch: { deltaMode?: number; ctrlKey?: boolean } = {}) => ({
  deltaY,
  deltaMode: patch.deltaMode ?? 0,
  ctrlKey: patch.ctrlKey ?? false,
});

describe("wheel zoom", () => {
  it("normalises line and page deltas to pixels", () => {
    expect(normalizeWheelDelta(wheel(3, { deltaMode: 1 }))).toBe(60);
    expect(normalizeWheelDelta(wheel(1, { deltaMode: 2 }), 600)).toBe(600);
    expect(normalizeWheelDelta(wheel(-40))).toBe(-40);
  });

  it("zooms in on scroll up and out on scroll down", () => {
    expect(wheelZoomFactor(wheel(-100))).toBeGreaterThan(1);
    expect(wheelZoomFactor(wheel(100))).toBeLessThan(1);
  });

  it("caps one mouse notch, however large the delta, at a small step", () => {
    expect(wheelZoomFactor(wheel(-100))).toBeCloseTo(1.07, 5);
    expect(wheelZoomFactor(wheel(-3, { deltaMode: 1 }))).toBeCloseTo(1.07, 5);
    expect(wheelZoomFactor(wheel(-2000))).toBeCloseTo(1.07, 5);
    expect(wheelZoomFactor(wheel(2000))).toBeCloseTo(1 / 1.07, 5);
  });

  it("keeps a trackpad pinch calm: dozens of events a second add up to a gentle zoom", () => {
    // A brisk pinch: 60 ctrlKey events of deltaY -2 in one second.
    let scale = 1;
    for (let i = 0; i < 60; i++) scale *= wheelZoomFactor(wheel(-2, { ctrlKey: true }));
    expect(scale).toBeGreaterThan(1.5);
    expect(scale).toBeLessThan(3);
    // A single spike never jumps more than 3 %.
    expect(wheelZoomFactor(wheel(-80, { ctrlKey: true }))).toBeCloseTo(1.03, 5);
  });

  it("keeps the scale between 0.3 and 2", () => {
    expect(clampScale(0.1)).toBe(MIN_SCALE);
    expect(clampScale(5)).toBe(MAX_SCALE);
    expect(clampScale(1.2)).toBe(1.2);
    expect([MIN_SCALE, MAX_SCALE]).toEqual([0.3, 2]);
  });
});

describe("zoomFrame", () => {
  it("eases out: most of the way early, landing softly", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(2)).toBe(1);
  });

  it("keeps the point under the anchor fixed through the whole zoom", () => {
    const from = { x: 40, y: -20, scale: 1 };
    const anchor = { x: 300, y: 200 };
    const contentPoint = {
      x: (anchor.x - from.x) / from.scale,
      y: (anchor.y - from.y) / from.scale,
    };
    for (const progress of [0, 0.3, 0.7, 1]) {
      const view = zoomFrame(from, 1.2, anchor, progress);
      expect(view.x + contentPoint.x * view.scale).toBeCloseTo(anchor.x);
      expect(view.y + contentPoint.y * view.scale).toBeCloseTo(anchor.y);
    }
    expect(zoomFrame(from, 1.2, anchor, 1).scale).toBeCloseTo(1.2);
    expect(zoomFrame(from, 1.2, anchor, 0)).toEqual(from);
  });
});
