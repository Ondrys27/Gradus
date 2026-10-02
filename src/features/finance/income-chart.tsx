"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { useReducedMotion } from "framer-motion";
import {
  Bar,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useLocale, useTranslations } from "next-intl";
import { MinusIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatCalendarDate,
  formatCurrency,
  formatDayOfMonth,
  formatMonthShort,
  formatMonthYear,
  formatNumber,
  isoDateToLocal,
  type IsoDate,
} from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import {
  balanceOf,
  chartRange,
  clampWindow,
  dailyChartRows,
  decimalsFor,
  fullWindow,
  monthlyChartRows,
  pageCount,
  panWindow,
  periodRange,
  zoomedRange,
  zoomWindow,
  PAGE_SIZE,
  type ChartKind,
  type ChartRow,
  type ZoomWindow,
} from "./finance-logic";
import { Pager } from "./pager";
import { Segmented } from "./segmented";
import { TransactionRow } from "./transactions-panel";
import { useDailyTotals, useMonthlyTotals, useTotals, useTransactions } from "./queries";

const CHART_HEIGHT = 220;
const BRUSH_HEIGHT = 28;
// Matches the YAxis width and the chart's right margin, to turn a pointer
// position into a fraction of the plotted area.
const PLOT_LEFT = 56;
const PLOT_RIGHT = 8;
const WHEEL_FACTOR = 1.2;
const BUTTON_FACTOR = 1.6;

type Gesture =
  | { mode: "pan"; startWindow: ZoomWindow; startX: number }
  | { mode: "pinch"; startWindow: ZoomWindow; startDistance: number; fraction: number };

/**
 * The income chart used both in the dashboard tile detail and on the Finance
 * page: a Month (days) / Year (months) toggle, zoomable bars with a
 * cumulative income line, and the transaction list of whatever is zoomed in.
 */
export function IncomeChart({ today }: { today: IsoDate }) {
  const t = useTranslations("finance.chart");
  const locale = useLocale();
  const settings = useFormatSettings();
  const reduceMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);

  const [kind, setKind] = useState<ChartKind>("month");
  const [zoom, setZoom] = useState<ZoomWindow>(fullWindow(0));
  const [page, setPage] = useState(0);

  const monthRange = useMemo(() => periodRange("thisMonth", today), [today]);
  const yearRange = useMemo(() => chartRange(today), [today]);
  const daily = useDailyTotals(monthRange);
  const monthly = useMonthlyTotals(yearRange);

  const failed = kind === "month" ? daily.isError : monthly.isError;
  const rows: ChartRow[] = useMemo(() => {
    if (kind === "month") return daily.data ? dailyChartRows(daily.data) : [];
    return monthly.data ? monthlyChartRows(monthly.data) : [];
  }, [kind, daily.data, monthly.data]);
  const plotRows = useMemo(
    () => rows.map((row) => ({ ...row, expenseNegative: -row.expense })),
    [rows],
  );

  // A fresh view (and the list back on page one) whenever the toggle changes
  // or the data first arrives.
  useEffect(() => {
    setZoom(fullWindow(rows.length));
    setPage(0);
  }, [kind, rows.length]);

  const range = rows.length > 0 ? zoomedRange(kind, rows, zoom) : monthRange;
  const totals = useTotals(range, null);
  const transactions = useTransactions(range, null, page);
  useEffect(() => setPage(0), [range.from, range.to]);

  function label(key: IsoDate) {
    return kind === "year"
      ? formatMonthYear(isoDateToLocal(key), locale)
      : formatCalendarDate(key, settings);
  }
  function money(value: number) {
    return formatCurrency(value, undefined, settings, decimalsFor(value));
  }

  function fractionAt(clientX: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return 0.5;
    const inner = Math.max(1, rect.width - PLOT_LEFT - PLOT_RIGHT);
    return Math.min(1, Math.max(0, (clientX - rect.left - PLOT_LEFT) / inner));
  }

  function zoomBy(factor: number) {
    if (rows.length === 0) return;
    setZoom((current) => zoomWindow(rows.length, current, factor, 0.5));
  }

  function resetZoom() {
    setZoom(fullWindow(rows.length));
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (rows.length === 0) return;
    event.preventDefault();
    const factor = event.deltaY > 0 ? WHEEL_FACTOR : 1 / WHEEL_FACTOR;
    setZoom((current) => zoomWindow(rows.length, current, factor, fractionAt(event.clientX)));
  }

  // Mouse drag and one-finger touch pan; two fingers pinch-zoom. The Brush
  // strip below the chart keeps handling its own drag, so pointers starting
  // there are left alone.
  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (rows.length === 0) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || event.clientY - rect.top > CHART_HEIGHT) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      gesture.current = { mode: "pan", startWindow: zoom, startX: event.clientX };
    } else if (pointers.current.size === 2) {
      const points = [...pointers.current.values()];
      gesture.current = {
        mode: "pinch",
        startWindow: zoom,
        startDistance: Math.max(1, Math.abs(points[0].x - points[1].x)),
        fraction: fractionAt((points[0].x + points[1].x) / 2),
      };
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = gesture.current;
    if (!current || rows.length === 0) return;
    if (current.mode === "pan" && pointers.current.size === 1) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const inner = Math.max(1, rect.width - PLOT_LEFT - PLOT_RIGHT);
      const size = current.startWindow.end - current.startWindow.start + 1;
      const pixelsPerIndex = inner / size;
      const deltaIndex = Math.round(-(event.clientX - current.startX) / pixelsPerIndex);
      setZoom(panWindow(rows.length, current.startWindow, deltaIndex));
    } else if (current.mode === "pinch" && pointers.current.size === 2) {
      const points = [...pointers.current.values()];
      const distance = Math.max(1, Math.abs(points[0].x - points[1].x));
      const factor = current.startDistance / distance;
      setZoom(zoomWindow(rows.length, current.startWindow, factor, current.fraction));
    }
  }

  function endPointer(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 1) {
      const [[, point]] = pointers.current;
      gesture.current = { mode: "pan", startWindow: zoom, startX: point.x };
    } else {
      gesture.current = null;
    }
  }

  const windowSize = zoom.end - zoom.start + 1;
  const canZoomIn = rows.length > 0 && windowSize > 2;
  const canZoomOut = rows.length > 0 && windowSize < rows.length;
  const canReset = zoom.start > 0 || zoom.end < rows.length - 1;
  const viewItems: { value: ChartKind; label: string }[] = [
    { value: "month", label: t("view.month") },
    { value: "year", label: t("view.year") },
  ];
  const empty = rows.length > 0 && rows.every((row) => row.income === 0 && row.expense === 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label={t("view.label")}
          value={kind}
          options={viewItems}
          onChange={(value) => setKind(value)}
          panelId={() => "income-chart"}
        />
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t("zoomOut")}
            disabled={!canZoomOut}
            onClick={() => zoomBy(BUTTON_FACTOR)}
          >
            <MinusIcon aria-hidden />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t("zoomIn")}
            disabled={!canZoomIn}
            onClick={() => zoomBy(1 / BUTTON_FACTOR)}
          >
            <PlusIcon aria-hidden />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t("resetZoom")}
            disabled={!canReset}
            onClick={resetZoom}
          >
            <RotateCcwIcon aria-hidden />
          </Button>
        </div>
      </div>

      <div
        id="income-chart"
        role="tabpanel"
        aria-labelledby={`tab-${kind}`}
        className="flex flex-col gap-4"
      >
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1 rounded-xl border border-line p-3">
            <span className="micro-label">{t("income")}</span>
            {totals.data ? (
              <span className="stat-number text-lg text-teal">{money(totals.data.income)}</span>
            ) : (
              <Skeleton className="h-7 w-2/3" />
            )}
          </div>
          <div className="flex flex-col gap-1 rounded-xl border border-line p-3">
            <span className="micro-label">{t("expense")}</span>
            {totals.data ? (
              <span className="stat-number text-lg text-pink">{money(totals.data.expense)}</span>
            ) : (
              <Skeleton className="h-7 w-2/3" />
            )}
          </div>
          <div className="flex flex-col gap-1 rounded-xl border border-line p-3">
            <span className="micro-label">{t("balance")}</span>
            {totals.data ? (
              <span className="stat-number text-lg text-ink">{money(balanceOf(totals.data))}</span>
            ) : (
              <Skeleton className="h-7 w-2/3" />
            )}
          </div>
        </div>

        {failed ? (
          <FormAlert>{t("loadFailed")}</FormAlert>
        ) : rows.length === 0 ? (
          <Skeleton style={{ height: CHART_HEIGHT + BRUSH_HEIGHT }} className="w-full" />
        ) : (
          <figure className="flex flex-col gap-2">
            <div
              ref={containerRef}
              onWheel={handleWheel}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endPointer}
              onPointerCancel={endPointer}
              style={{ height: CHART_HEIGHT + BRUSH_HEIGHT }}
              className="relative touch-none select-none"
            >
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={plotRows}
                  margin={{ top: 8, right: PLOT_RIGHT, bottom: 0, left: 0 }}
                >
                  <CartesianGrid vertical={false} stroke="var(--color-line)" strokeOpacity={0.5} />
                  <ReferenceLine yAxisId="bars" y={0} stroke="var(--color-line-strong)" />
                  <XAxis
                    dataKey="key"
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={16}
                    tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
                    tickFormatter={(value: string) =>
                      kind === "month"
                        ? formatDayOfMonth(isoDateToLocal(value), settings)
                        : formatMonthShort(isoDateToLocal(value), locale)
                    }
                  />
                  <YAxis
                    yAxisId="bars"
                    width={PLOT_LEFT}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
                    tickFormatter={(value: number) => formatNumber(value, {}, settings)}
                  />
                  <YAxis yAxisId="cumulative" hide domain={[0, "auto"]} />
                  <Tooltip
                    cursor={{ fill: "var(--color-surface-hover)" }}
                    content={({ active, payload }) => {
                      const row = active
                        ? (payload?.[0]?.payload as (typeof plotRows)[number] | undefined)
                        : undefined;
                      if (!row) return null;
                      return (
                        <div className="rounded-xl border border-line-strong bg-surface px-3 py-2 text-xs shadow-popover">
                          <p className="text-ink-muted">{label(row.key)}</p>
                          <p className="font-semibold text-teal tabular-nums">
                            {t("income")}: {money(row.income)}
                          </p>
                          <p className="font-semibold text-pink tabular-nums">
                            {t("expense")}: {money(row.expense)}
                          </p>
                          <p className="font-semibold text-ink tabular-nums">
                            {t("balance")}: {money(balanceOf(row))}
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    yAxisId="bars"
                    dataKey="income"
                    fill="var(--color-teal)"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={kind === "month" ? 14 : 28}
                    isAnimationActive={!reduceMotion}
                  />
                  <Bar
                    yAxisId="bars"
                    dataKey="expenseNegative"
                    fill="var(--color-pink)"
                    radius={[0, 0, 3, 3]}
                    maxBarSize={kind === "month" ? 7 : 14}
                    isAnimationActive={!reduceMotion}
                  />
                  <Line
                    yAxisId="cumulative"
                    type="monotone"
                    dataKey="cumulativeIncome"
                    stroke="var(--color-gold)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={!reduceMotion}
                  />
                  <Brush
                    dataKey="key"
                    height={BRUSH_HEIGHT}
                    travellerWidth={10}
                    startIndex={zoom.start}
                    endIndex={zoom.end}
                    stroke="var(--color-violet)"
                    fill="var(--color-surface)"
                    tickFormatter={(_, index) => label(plotRows[index]?.key ?? plotRows[0].key)}
                    onChange={(next) =>
                      setZoom(
                        clampWindow(rows.length, { start: next.startIndex, end: next.endIndex }),
                      )
                    }
                  />
                </ComposedChart>
              </ResponsiveContainer>
              {empty && (
                <p className="pointer-events-none absolute inset-0 grid place-items-center px-4 text-center text-sm text-ink-muted">
                  <span className="rounded-xl bg-surface px-3 py-1">{t("empty")}</span>
                </p>
              )}
            </div>
            <ul className="flex items-center gap-4 text-xs text-ink-soft">
              <li className="flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-sm bg-teal" />
                {t("income")}
              </li>
              <li className="flex items-center gap-1.5">
                <span aria-hidden className="h-1.5 w-3 rounded-full bg-pink" />
                {t("expense")}
              </li>
              <li className="flex items-center gap-1.5">
                <span aria-hidden className="h-0.5 w-3 rounded-full bg-gold" />
                {t("cumulativeIncome")}
              </li>
            </ul>
            <table className="sr-only">
              <caption>{t("srTitle")}</caption>
              <thead>
                <tr>
                  <th scope="col">{label(rows[0].key)}</th>
                  <th scope="col">{t("income")}</th>
                  <th scope="col">{t("expense")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{label(row.key)}</th>
                    <td>{money(row.income)}</td>
                    <td>{money(row.expense)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </figure>
        )}

        <div className="flex flex-col gap-2">
          <h3 className="micro-label">{t("transactions")}</h3>
          {transactions.isError ? (
            <FormAlert>{t("loadFailed")}</FormAlert>
          ) : !transactions.data ? (
            <div className="flex flex-col gap-2" aria-hidden>
              {[0, 1].map((row) => (
                <Skeleton key={row} className="h-16 w-full" />
              ))}
            </div>
          ) : transactions.data.rows.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("noTransactions")}</p>
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {transactions.data.rows.map((transaction) => (
                  <li key={transaction.id}>
                    <TransactionRow transaction={transaction} />
                  </li>
                ))}
              </ul>
              <Pager
                page={page}
                pages={pageCount(transactions.data.total, PAGE_SIZE)}
                onPage={setPage}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
