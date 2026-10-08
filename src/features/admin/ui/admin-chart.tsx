"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslations } from "next-intl";
import { DownloadIcon, ImageIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { wheelZoomFactor } from "@/components/tree-map/tree-map-zoom";
import type { MetricUnit } from "@/lib/analytics/metrics";
import { formatCalendarDate, formatDayMonth } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toCsv } from "../access";
import { ADMIN_FORMAT_SETTINGS, formatMetricValue } from "../format-metric";
import {
  clampIndexWindow,
  fullIndexWindow,
  isFullWindow,
  scaleIndexWindow,
  visibleRows,
  type IndexWindow,
} from "../numbers";
import { recordExport } from "../server/export-actions";
import type { ChartData, ChartSeries } from "../types";
import { AdminEmpty } from "./blocks";
import { downloadBlob, svgToPngBlob } from "./export-image";

const AXIS_WIDTH = 56;
const MARGIN_RIGHT = 8;
/** Pixels the pointer must travel before a press becomes a zoom selection. */
const DRAG_THRESHOLD = 6;

type Selection = { from: number; to: number; startX: number; moved: boolean };

function colorVar(series: ChartSeries) {
  return `var(--color-${series.color})`;
}

/**
 * The one chart of the administration. Drag across an area to zoom into it,
 * the wheel zooms as calmly as the task map, a double click returns to the
 * whole period. Series switch on and off in the legend; the visible part can
 * be saved as PNG or CSV, each export written to the audit first.
 */
export function AdminChart({
  data,
  title,
  height = 260,
}: {
  data: ChartData;
  title: string;
  height?: number;
}) {
  const t = useTranslations();
  const tChart = useTranslations("admin.chart");
  const tUnits = useTranslations("admin.units");
  const containerRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(data.series.filter((series) => series.hidden).map((series) => series.key)),
  );
  const [zoom, setZoom] = useState<IndexWindow>(() => fullIndexWindow(data.rows.length));
  const [selection, setSelection] = useState<Selection | null>(null);
  const [exporting, setExporting] = useState<"csv" | "png" | null>(null);
  const [exportFailed, setExportFailed] = useState(false);
  const length = data.rows.length;

  // New data (another period, a refresh with more days) shows in full.
  useEffect(() => setZoom(fullIndexWindow(length)), [length, data.id]);

  const visible = visibleRows(length, zoom);
  const rows = useMemo(
    () => data.rows.slice(visible.start, visible.end + 1),
    [data.rows, visible.start, visible.end],
  );
  const hasRight = data.series.some((series) => series.axis === "right");
  const plotLeft = AXIS_WIDTH;
  const plotRight = MARGIN_RIGHT + (hasRight ? AXIS_WIDTH : 0);

  const empty = data.rows.every((row) =>
    data.series.every((series) => {
      const value = row[series.key];
      return value === null || value === undefined || value === 0;
    }),
  );

  function seriesName(series: ChartSeries): string {
    if (series.label) return t(`admin.${series.label.key}`, series.label.values ?? {});
    return t(`metrics.items.${series.key}.name`);
  }

  function unitOf(series: ChartSeries): MetricUnit {
    return series.axis === "right" ? (data.rightUnit ?? data.unit) : data.unit;
  }

  function xLabel(x: string, long = false): string {
    if (data.xKind === "week") return tChart("week", { n: Number(x) });
    return long
      ? formatCalendarDate(x, ADMIN_FORMAT_SETTINGS)
      : formatDayMonth(x, ADMIN_FORMAT_SETTINGS);
  }

  /** Where a pointer is across the plotted area, 0–1. */
  function fractionAt(clientX: number): number {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return 0.5;
    const inner = Math.max(1, rect.width - plotLeft - plotRight);
    return Math.min(1, Math.max(0, (clientX - rect.left - plotLeft) / inner));
  }

  /** The row under a pointer (bars sit in equal bands across the plot). */
  function indexAt(clientX: number): number {
    const count = rows.length;
    return visible.start + Math.min(count - 1, Math.floor(fractionAt(clientX) * count));
  }

  // The wheel needs a non-passive listener to keep the page from scrolling
  // while the chart zooms. Zooming out of the full period lets the page scroll.
  const stateRef = useRef({ length, zoom });
  stateRef.current = { length, zoom };
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      const { length: count, zoom: current } = stateRef.current;
      if (count <= 2) return;
      const scale = wheelZoomFactor(event, element.clientHeight);
      if (scale < 1 && isFullWindow(count, current)) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const inner = Math.max(1, rect.width - plotLeft - plotRight);
      const anchor = Math.min(1, Math.max(0, (event.clientX - rect.left - plotLeft) / inner));
      setZoom((previous) => scaleIndexWindow(count, previous, scale, anchor));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [plotLeft, plotRight, empty]);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (length <= 2 || (event.pointerType === "mouse" && event.button !== 0)) return;
    const index = indexAt(event.clientX);
    setSelection({ from: index, to: index, startX: event.clientX, moved: false });
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!selection) return;
    const moved = selection.moved || Math.abs(event.clientX - selection.startX) > DRAG_THRESHOLD;
    if (moved && !selection.moved) event.currentTarget.setPointerCapture(event.pointerId);
    setSelection({ ...selection, to: indexAt(event.clientX), moved });
  }

  function handlePointerUp() {
    if (selection?.moved && selection.from !== selection.to) {
      setZoom(
        clampIndexWindow(length, {
          start: Math.min(selection.from, selection.to),
          end: Math.max(selection.from, selection.to),
        }),
      );
    }
    setSelection(null);
  }

  function toggle(key: string) {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function exportAs(kind: "csv" | "png") {
    setExporting(kind);
    setExportFailed(false);
    try {
      // Built before asking, so a chart that can not be drawn writes no audit row.
      let blob: Blob;
      if (kind === "csv") {
        const header = ["x", ...data.series.map((series) => series.key)];
        const body = rows.map((row) => [
          row.x,
          ...data.series.map((series) => {
            const value = row[series.key];
            return typeof value === "number" ? value : null;
          }),
        ]);
        blob = new Blob([toCsv(header, body)], { type: "text/csv;charset=utf-8" });
      } else {
        const svg = containerRef.current?.querySelector<SVGSVGElement>("svg.recharts-surface");
        if (!svg || !containerRef.current) throw new Error("No chart to export");
        blob = await svgToPngBlob(svg, containerRef.current);
      }
      const { ok } = await recordExport(`chart.${data.id}.${kind}`);
      if (!ok) throw new Error("Audit refused the export");
      const first = rows[0]?.x ?? "";
      const last = rows[rows.length - 1]?.x ?? "";
      downloadBlob(blob, `${data.id.replace(/\./g, "-")}_${first}_${last}.${kind}`);
    } catch (error) {
      console.error("[admin] chart export failed", error);
      setExportFailed(true);
    } finally {
      setExporting(null);
    }
  }

  const zoomed = !isFullWindow(length, zoom);
  const selectionArea =
    selection?.moved && selection.from !== selection.to
      ? {
          x1: data.rows[Math.min(selection.from, selection.to)]?.x,
          x2: data.rows[Math.max(selection.from, selection.to)]?.x,
        }
      : null;

  return (
    <figure className="flex min-w-0 flex-col gap-2" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ul className="flex flex-wrap items-center gap-1" aria-label={tChart("legend")}>
          {data.series.map((series) => {
            const off = hidden.has(series.key);
            return (
              <li key={series.key}>
                <button
                  type="button"
                  aria-pressed={!off}
                  onClick={() => toggle(series.key)}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-7",
                    off ? "text-ink-muted line-through" : "text-ink-soft hover:text-ink",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "shrink-0",
                      series.kind === "bar" ? "size-2.5 rounded-sm" : "h-1 w-3.5 rounded-full",
                      off && "opacity-30",
                    )}
                    style={{ background: colorVar(series) }}
                  />
                  {seriesName(series)}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-0.5">
          {zoomed && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setZoom(fullIndexWindow(length))}
            >
              <RotateCcwIcon aria-hidden />
              {tChart("reset")}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={tChart("exportCsv")}
            title={tChart("exportCsv")}
            disabled={empty || exporting !== null}
            onClick={() => void exportAs("csv")}
          >
            <DownloadIcon aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={tChart("exportPng")}
            title={tChart("exportPng")}
            disabled={empty || exporting !== null}
            onClick={() => void exportAs("png")}
          >
            <ImageIcon aria-hidden />
          </Button>
        </div>
      </div>

      {exportFailed && <FormAlert>{tChart("exportFailed")}</FormAlert>}

      {empty ? (
        <AdminEmpty className="py-12" />
      ) : (
        <div
          ref={containerRef}
          style={{ height }}
          className="relative cursor-crosshair touch-pan-y select-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => setSelection(null)}
          onDoubleClick={() => setZoom(fullIndexWindow(length))}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: MARGIN_RIGHT, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--color-line)" strokeOpacity={0.5} />
              <XAxis
                dataKey="x"
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={20}
                tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
                tickFormatter={(value: string) => xLabel(value)}
              />
              <YAxis
                yAxisId="left"
                width={AXIS_WIDTH}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
                tickFormatter={(value: number) => formatMetricValue(value, data.unit, tUnits)}
              />
              {hasRight && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  width={AXIS_WIDTH}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                  tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
                  tickFormatter={(value: number) =>
                    formatMetricValue(value, data.rightUnit ?? data.unit, tUnits)
                  }
                />
              )}
              <Tooltip
                cursor={{ fill: "var(--color-surface-hover)", stroke: "var(--color-line-strong)" }}
                isAnimationActive={false}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length || selection?.moved) return null;
                  return (
                    <div className="min-w-40 rounded-xl border border-line-strong bg-surface px-3 py-2 text-xs shadow-popover">
                      <p className="mb-1 text-ink-muted">{xLabel(String(label), true)}</p>
                      {data.series
                        .filter((series) => !hidden.has(series.key))
                        .map((series) => {
                          const raw = payload[0]?.payload?.[series.key];
                          return (
                            <p key={series.key} className="flex items-center justify-between gap-3">
                              <span className="flex items-center gap-1.5 text-ink-soft">
                                <span
                                  aria-hidden
                                  className="size-2 rounded-full"
                                  style={{ background: colorVar(series) }}
                                />
                                {seriesName(series)}
                              </span>
                              <span className="font-semibold text-ink tabular-nums">
                                {formatMetricValue(
                                  typeof raw === "number" ? raw : null,
                                  unitOf(series),
                                  tUnits,
                                )}
                              </span>
                            </p>
                          );
                        })}
                    </div>
                  );
                }}
              />
              {data.series.map((series) => {
                const common = {
                  dataKey: series.key,
                  yAxisId: series.axis === "right" ? "right" : "left",
                  hide: hidden.has(series.key),
                  isAnimationActive: false,
                  name: seriesName(series),
                };
                if (series.kind === "bar") {
                  return (
                    <Bar
                      {...common}
                      key={series.key}
                      fill={colorVar(series)}
                      fillOpacity={0.85}
                      radius={[3, 3, 0, 0]}
                      maxBarSize={18}
                    />
                  );
                }
                if (series.kind === "area") {
                  return (
                    <Area
                      {...common}
                      key={series.key}
                      type="monotone"
                      stroke={colorVar(series)}
                      strokeWidth={2}
                      fill={colorVar(series)}
                      fillOpacity={0.14}
                      connectNulls={false}
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                  );
                }
                return (
                  <Line
                    {...common}
                    key={series.key}
                    type="monotone"
                    stroke={colorVar(series)}
                    strokeWidth={2}
                    strokeDasharray={series.dashed ? "5 4" : undefined}
                    connectNulls={false}
                    dot={rows.length <= 14 ? { r: 2.5 } : false}
                    activeDot={{ r: 3.5 }}
                  />
                );
              })}
              {selectionArea?.x1 !== undefined && selectionArea.x2 !== undefined && (
                <ReferenceArea
                  yAxisId="left"
                  x1={selectionArea.x1}
                  x2={selectionArea.x2}
                  fill="var(--color-violet)"
                  fillOpacity={0.15}
                  stroke="var(--color-violet)"
                  strokeOpacity={0.6}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      {!empty && length > 2 && (
        <figcaption className="text-xs text-ink-muted">{tChart("hint")}</figcaption>
      )}
    </figure>
  );
}
