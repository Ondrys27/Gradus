import type { IsoDate } from "@/lib/format";
import { daysBetween, type MetricUnit } from "@/lib/analytics/metrics";
import type { DateRange } from "./view-state";

/**
 * Pure arithmetic of the administration pages: how a series becomes one
 * number on a tile, the change against the previous period, the buckets of a
 * sparkline and the zoom window of a chart.
 */

export type Point = { day: IsoDate; value: number | null };

/** How a daily series becomes the one number of a tile. */
export type Aggregate = "sum" | "mean" | "last";

export function aggregate(points: readonly Point[], how: Aggregate): number | null {
  const values = points
    .map((point) => point.value)
    .filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  switch (how) {
    case "sum":
      return values.reduce((sum, value) => sum + value, 0);
    case "mean":
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    case "last":
      return values[values.length - 1];
  }
}

/**
 * Change against the previous period in percent. Null when there is nothing
 * to compare with (no previous value, or it was zero).
 */
export function percentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Whether a change is good news: fewer costs and fewer lost users are good. */
export function changeTone(change: number | null, lowerIsBetter = false): "up" | "down" | "flat" {
  if (change === null || Math.abs(change) < 0.05) return "flat";
  const better = lowerIsBetter ? change < 0 : change > 0;
  return better ? "up" : "down";
}

/**
 * Splits a range into at most `count` consecutive parts of (nearly) equal
 * length, for sparklines of numbers that exist only for a whole range.
 */
export function splitRange(range: DateRange, count: number): DateRange[] {
  const days = daysBetween(range.from, range.to);
  const parts = Math.max(1, Math.min(count, days.length));
  const result: DateRange[] = [];
  let start = 0;
  for (let i = 0; i < parts; i++) {
    const end = Math.round(((i + 1) * days.length) / parts) - 1;
    result.push({ from: days[start], to: days[end] });
    start = end + 1;
  }
  return result;
}

/**
 * Every day of the range with the series' value. Days missing from the rows
 * get `fill`: zero for event counts (nothing happened), null for daily
 * metrics (not computed).
 */
export function alignToRange(
  points: readonly Point[],
  range: DateRange,
  fill: number | null = null,
): Point[] {
  const byDay = new Map(points.map((point) => [point.day.slice(0, 10), point.value]));
  return daysBetween(range.from, range.to).map((day) => ({
    day,
    value: byDay.has(day) ? (byDay.get(day) ?? null) : fill,
  }));
}

/** Values of a metric unit as stored: percent is 0–100, ratio 0–1. */
export function toFraction(value: number, unit: MetricUnit): number {
  return unit === "percent" ? value / 100 : value;
}

/** Whether a unit is shown as a percentage. */
export function isShare(unit: MetricUnit): boolean {
  return unit === "percent" || unit === "ratio";
}

// --- Chart zoom ----------------------------------------------------------------

/**
 * The visible part of a chart as fractional indexes into its rows, so many
 * small wheel steps add up instead of rounding away; visibleRows() rounds.
 */
export type IndexWindow = { start: number; end: number };

export function fullIndexWindow(length: number): IndexWindow {
  return { start: 0, end: Math.max(0, length - 1) };
}

/** Keeps a window inside the data and at least one step wide. */
export function clampIndexWindow(length: number, window: IndexWindow): IndexWindow {
  if (length <= 2) return fullIndexWindow(length);
  const last = length - 1;
  let start = Math.min(window.start, window.end);
  let end = Math.max(window.start, window.end);
  const span = Math.min(last, Math.max(1, end - start));
  if (end - start < span) end = start + span;
  if (start < 0) {
    start = 0;
    end = span;
  }
  if (end > last) {
    end = last;
    start = last - span;
  }
  return { start, end };
}

/**
 * Zooms a window by `scale` (above 1 zooms in) around the point at `anchor`
 * (0 = left edge, 1 = right edge of the visible part).
 */
export function scaleIndexWindow(
  length: number,
  window: IndexWindow,
  scale: number,
  anchor: number,
): IndexWindow {
  if (length <= 2 || !(scale > 0)) return clampIndexWindow(length, window);
  const span = window.end - window.start;
  const nextSpan = Math.min(length - 1, Math.max(1, span / scale));
  const pivot = window.start + span * Math.min(1, Math.max(0, anchor));
  const start = pivot - (pivot - window.start) * (nextSpan / Math.max(span, 1e-9));
  return clampIndexWindow(length, { start, end: start + nextSpan });
}

/** The whole rows a window shows. */
export function visibleRows(length: number, window: IndexWindow): { start: number; end: number } {
  if (length === 0) return { start: 0, end: -1 };
  return {
    start: Math.max(0, Math.floor(window.start + 1e-9)),
    end: Math.min(length - 1, Math.ceil(window.end - 1e-9)),
  };
}

export function isFullWindow(length: number, window: IndexWindow): boolean {
  const rows = visibleRows(length, window);
  return rows.start <= 0 && rows.end >= length - 1;
}

/** Saturation of a heat-map cell, 0–1, so that even small values stay visible. */
export function heat(value: number | null, max: number): number {
  if (value === null || value <= 0 || max <= 0) return 0;
  return Math.min(1, 0.12 + 0.88 * (value / max));
}

// --- NPS -------------------------------------------------------------------------

/**
 * The Net Promoter Score from the 0–10 breakdown ("nps" metric): share of
 * promoters (9–10) minus detractors (0–6), -100 to 100. Null without answers.
 */
export function npsScore(items: readonly { key: string; value: number | null }[]): number | null {
  const total = items.reduce((sum, item) => sum + (item.value ?? 0), 0);
  if (total <= 0) return null;
  const group = (from: number, to: number) =>
    items
      .filter((item) => {
        const score = Number(item.key);
        return Number.isFinite(score) && score >= from && score <= to;
      })
      .reduce((sum, item) => sum + (item.value ?? 0), 0);
  const promoters = group(9, 10);
  const detractors = group(0, 6);
  return ((promoters - detractors) / total) * 100;
}
