import { describe, expect, it } from "vitest";
import { wheelZoomFactor } from "@/components/tree-map/tree-map-zoom";
import { decimalsFor, formatChange, formatMetricValue, metricCsvValue } from "./format-metric";
import {
  aggregate,
  alignToRange,
  changeTone,
  clampIndexWindow,
  fullIndexWindow,
  heat,
  isFullWindow,
  percentChange,
  scaleIndexWindow,
  splitRange,
  visibleRows,
} from "./numbers";

const points = [
  { day: "2026-10-01", value: 2 },
  { day: "2026-10-02", value: null },
  { day: "2026-10-03", value: 4 },
];

describe("tile numbers", () => {
  it("aggregates a daily series", () => {
    expect(aggregate(points, "sum")).toBe(6);
    expect(aggregate(points, "mean")).toBe(3);
    expect(aggregate(points, "last")).toBe(4);
    expect(aggregate([], "sum")).toBeNull();
  });

  it("computes the change against the previous period", () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(null, 3)).toBeNull();
  });

  it("knows when lower is better", () => {
    expect(changeTone(10)).toBe("up");
    expect(changeTone(10, true)).toBe("down");
    expect(changeTone(-10, true)).toBe("up");
    expect(changeTone(0)).toBe("flat");
    expect(changeTone(null)).toBe("flat");
  });

  it("splits a range into nearly equal parts that cover it", () => {
    const parts = splitRange({ from: "2026-10-01", to: "2026-10-30" }, 6);
    expect(parts).toHaveLength(6);
    expect(parts[0]).toEqual({ from: "2026-10-01", to: "2026-10-05" });
    expect(parts[5].to).toBe("2026-10-30");
    expect(splitRange({ from: "2026-10-01", to: "2026-10-02" }, 6)).toHaveLength(2);
  });

  it("aligns rows to every day of the range", () => {
    const aligned = alignToRange(
      [{ day: "2026-10-02", value: 7 }],
      {
        from: "2026-10-01",
        to: "2026-10-03",
      },
      0,
    );
    expect(aligned.map((point) => point.value)).toEqual([0, 7, 0]);
  });

  it("keeps heat-map cells visible", () => {
    expect(heat(0, 10)).toBe(0);
    expect(heat(1, 100)).toBeGreaterThan(0.1);
    expect(heat(10, 10)).toBe(1);
  });
});

describe("chart zoom", () => {
  it("keeps the window inside the data", () => {
    expect(clampIndexWindow(10, { start: -3, end: 2 })).toEqual({ start: 0, end: 5 });
    expect(clampIndexWindow(10, { start: 8, end: 12 })).toEqual({ start: 5, end: 9 });
    expect(clampIndexWindow(10, { start: 4, end: 4 })).toEqual({ start: 4, end: 5 });
  });

  it("zooms around the pointer and back out to the full range", () => {
    const zoomed = scaleIndexWindow(101, fullIndexWindow(101), 2, 0.5);
    expect(zoomed).toEqual({ start: 25, end: 75 });
    const out = scaleIndexWindow(101, zoomed, 0.25, 0.5);
    expect(isFullWindow(101, out)).toBe(true);
  });

  it("adds up many calm wheel steps instead of rounding them away", () => {
    let window = fullIndexWindow(30);
    for (let i = 0; i < 10; i++) {
      window = scaleIndexWindow(
        30,
        window,
        wheelZoomFactor({ deltaY: -100, deltaMode: 0, ctrlKey: false }),
        0.5,
      );
    }
    const rows = visibleRows(30, window);
    expect(rows.end - rows.start).toBeLessThan(20);
    expect(rows.end - rows.start).toBeGreaterThan(10);
  });
});

describe("metric values", () => {
  const t = (key: string, values?: Record<string, string | number>) =>
    values ? `${values.value} ${key}` : key;

  it("formats by unit", () => {
    expect(formatMetricValue(null, "users", t)).toBe("none");
    expect(formatMetricValue(1234, "users", t)).toBe("1 234".replace(" ", " "));
    expect(formatMetricValue(42.5, "percent", t)).toMatch(/^42,5\s%$/);
    expect(formatMetricValue(0.25, "ratio", t)).toMatch(/^25,0\s%$/);
    expect(formatMetricValue(1.5, "usd", t)).toMatch(/1,50/);
    expect(formatMetricValue(12, "hours", t)).toBe("12 hours");
  });

  it("shows US dollars always with two decimals and the code", () => {
    const plain = (text: string) => text.replace(/\s/g, " ");
    expect(plain(formatMetricValue(0, "usd", t))).toBe("0,00 USD");
    expect(plain(formatMetricValue(1.2, "usd", t))).toBe("1,20 USD");
    expect(plain(formatMetricValue(0.004, "usd", t))).toBe("0,00 USD");
    expect(plain(formatMetricValue(12.4, "usd", t))).toBe("12,40 USD");
    expect(plain(formatMetricValue(1234.5, "usd", t))).toBe("1 234,50 USD");
    expect(plain(formatMetricValue(90, "usd", t))).toBe("90,00 USD");
    expect(formatMetricValue(null, "usd", t)).toBe("none");
    for (const value of [0, 1, 1.2, 150, 2500]) expect(decimalsFor(value, "usd")).toBe(2);
    // Other units keep their decimals: whole stays whole, small averages one decimal.
    expect(decimalsFor(150)).toBe(0);
    expect(decimalsFor(4.25)).toBe(1);
    expect(plain(formatMetricValue(150, "czk", t))).toBe("150 Kč");
  });

  it("exports US dollars with two decimals and other values as plain numbers", () => {
    expect(metricCsvValue(1.2, "usd")).toBe("1.20");
    expect(metricCsvValue(0, "usd")).toBe("0.00");
    expect(metricCsvValue(1234.5, "usd")).toBe("1234.50");
    expect(metricCsvValue(null, "usd")).toBeNull();
    expect(metricCsvValue(42, "count")).toBe(42);
  });

  it("signs a change", () => {
    expect(formatChange(12.5)).toMatch(/^\+12,5\s%$/);
    expect(formatChange(-3)).toMatch(/^-3,0\s%$/);
    expect(formatChange(0)).toMatch(/^0,0\s%$/);
  });
});
